import { Component, OnInit, OnDestroy, AfterViewChecked, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  ReactiveFormsModule, FormsModule,
  FormBuilder, FormGroup, Validators
} from '@angular/forms';

import { ApiService }  from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import {
  Mesure, Recommandation,
  Equipement, Energie, Zone, OllamaMessage
} from '../../core/api/api.models';

// ─── Local interfaces ─────────────────────────────────────────────────────────

interface ToastMsg   { id: number; msg: string; type: 'success'|'error'|'info'|'warn'; }
interface ChartPoint { label: string; value: number; x: number; y: number; }

interface Seuil {
  id:             number;
  energieId:      number;
  nom:            string;
  periode:        string;
  annee:          number;
  valeurCible:    number;
  valeurActuelle: number;
  unite:          string;
}

interface BenchmarkItem {
  energie:       string;
  unite:         string;
  moisActuel:    number;
  moisPrecedent: number;
  moyenne:       number;
  variation:     number;
  position:      'better'|'same'|'worse';
  insight:       string;
  hasData:       boolean;
}

interface AlerteExt {
  idAlerte:      number;
  type:          string;
  message:       string;
  seuil:         number;
  severite:      string;
  traite:        boolean;
  dateCreation:  string;
  sourceAuto?:   boolean;
}

interface AnomalieExt {
  id:            number;
  description:   string;
  dateDetection: string;
  resolu:        boolean;
  type?:         string;
  energieNom?:   string;
  energieId?:    number | null;
}

interface SparkSeries { energieId: number; points: number[]; }

// ─── Noms canoniques des énergies ────────────────────────────────────────────
const NOM_ELECTRICITE = 'Electricité';
const NOM_EAU         = 'Eau';
const NOM_GAZOIL      = 'Gazoil';

const TARIFS_PAR_NOM: Record<string, number> = {
  [NOM_ELECTRICITE]: 0.28,
  [NOM_EAU]:         0.85,
  [NOM_GAZOIL]:      2.10,
};

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector:    'wic-energy-dashboard',
  standalone:  true,
  imports:     [CommonModule, RouterModule, ReactiveFormsModule, FormsModule],
  templateUrl: './energy-dashboard.component.html',
  styleUrls:   ['./energy-dashboard.component.css'],
})
export class EnergyDashboardComponent implements OnInit, OnDestroy {

  @ViewChild('chatScrollRef') private chatScrollRef!: ElementRef;

  // ── State ──────────────────────────────────────────────────────────────────
  activeTab    = 'overview';
  currentUser  = this.auth.getCurrentUser();
  currentTime  = new Date();
  loading      = true;
  navCollapsed = false;

  private clockInterval!: ReturnType<typeof setInterval>;
  private toastCounter = 0;

  // ── Data ───────────────────────────────────────────────────────────────────
  mesures:         Mesure[]         = [];
  alertes:         AlerteExt[]      = [];
  anomalies:       AnomalieExt[]    = [];
  recommandations: Recommandation[] = [];
  equipements:     Equipement[]     = [];
  energies:        Energie[]        = [];
  zones:           Zone[]           = [];
  toasts:          ToastMsg[]       = [];
  apiErrors:       Record<string, boolean> = {};

  // ── Sparklines ────────────────────────────────────────────────────────────
  sparklines: SparkSeries[] = [];

  // ── Goal targets ─────────────────────────────────────────────────────────
  objectifReductionPct = 10;

  // ── Date filter ───────────────────────────────────────────────────────────
  dateFilterFrom  = '';
  dateFilterTo    = '';
  dateQuickPeriod = '';

  // ── Modals ─────────────────────────────────────────────────────────────────
  showMesureModal     = false; mesureForm!:     FormGroup; mesureSaving     = false; mesureSaved     = false;
  showEquipementModal = false; equipementForm!: FormGroup; equipementSaving = false; equipementSaved = false;
  editingEquipement: Equipement | null = null;
  showDeleteConfirm = false; equipementToDelete: Equipement | null = null;

  showSeuilModal = false; seuilForm!: FormGroup; seuilSaving = false; seuilSaved = false;
  editingSeuil: Seuil | null = null;
  seuilsList:       Seuil[] = [];
  seuilsHistorique: Seuil[] = [];

  showAlerteModal = false; alerteForm!: FormGroup; alerteSaving = false; alerteSaved = false;
  alertesAutoGenerees = 0;

  showAnomalieModal = false; anomalieForm!: FormGroup; anomalieSaving = false; anomalieSaved = false;

  showRecoModal = false; recoForm!: FormGroup; recoSaving = false; recoSaved = false;

  // ── Filters — Equipements ─────────────────────────────────────────────────
  searchEquip       = ''; filterEquipType = ''; filterEquipStatut = '';
  equipPage = 1; equipPerPage = 8;

  // ── Filters — Alertes ─────────────────────────────────────────────────────
  searchAlerte = ''; filterAlertType = ''; filterAlertSeverite = ''; filterAlertStatut = '';

  // ── Filters — Anomalies ───────────────────────────────────────────────────
  searchAnomalie = ''; filterAnomalieStatus = ''; filterAnomalieType = '';
  private progressMap = new Map<number, number>();

  // ── Filters — Recommandations ─────────────────────────────────────────────
  filterRecoPriorite = ''; filterRecoApplique = '';

  // ── Chart ─────────────────────────────────────────────────────────────────
  chartPeriod: '7j'|'30j'|'90j' = '7j';
  alertThreshold = 200;
  readonly CHART_W     = 800;
  readonly CHART_H     = 160;
  readonly CHART_PAD_X = 42;
  readonly CHART_PAD_Y = 16;
  hoveredPoint:   ChartPoint | null = null;
  hoveredPointN1: ChartPoint | null = null;
  showComparaison = false;
  tarifKwh = 0.28;

  // ── Chat IA ────────────────────────────────────────────────────────────────
  showChat = false; messages: OllamaMessage[] = []; chatInput = ''; chatLoading = false;

  // ── Heatmap ────────────────────────────────────────────────────────────────
  offHoursMode   = false;
  heatmapEnergie = '';
  heatmapHovered: { day: number; hour: number; val: number } | null = null;
  heatmapData: number[][] = []; heatmapDays: string[] = []; heatmapHourLabels: string[] = [];

  // ── Benchmarking ───────────────────────────────────────────────────────────
  benchmarkData: BenchmarkItem[] = [];
  rankTimeline:  { label: string; pct: number }[] = [];

  // ── Prévisions ─────────────────────────────────────────────────────────────
  previsionMoisProchain = {
    elec: 0, eau: 0, gazoil: 0, fiabilite: 0,
    elecTrend: 'flat' as 'up'|'down'|'flat',
    elecVar: '0', hasEnoughData: false,
  };
  previsionRecos: { titre: string; description: string; economie: number; urgence: string }[] = [];
  forecastPoints: ChartPoint[] = [];

  min = Math.min;
  Math = Math;

  // ── Mesures table ─────────────────────────────────────────────────────────
  mesuresTab: 'table'|'chart' = 'chart';
  mesurePage = 1; mesurePerPage = 10;
  searchMesure = ''; filterMesureEnergie = '';

  constructor(
    private api:  ApiService,
    private auth: AuthService,
    private fb:   FormBuilder,
    private cdr:  ChangeDetectorRef,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // ✅ Résolution des IDs par nom
  // ══════════════════════════════════════════════════════════════════════════

  private getIdByNom(nom: string): number {
    return this.energies.find(
      e => (e.nom ?? '').toLowerCase().trim() === nom.toLowerCase().trim()
    )?.idEnergie ?? 0;
  }

  get idElec():   number { return this.getIdByNom(NOM_ELECTRICITE); }
  get idEau():    number { return this.getIdByNom(NOM_EAU); }
  get idGazoil(): number { return this.getIdByNom(NOM_GAZOIL); }

  private getTarifById(energieId: number): number {
    const nom = this.getEnergieNom(energieId);
    const key = Object.keys(TARIFS_PAR_NOM).find(
      k => k.toLowerCase().trim() === nom.toLowerCase().trim()
    );
    return key ? TARIFS_PAR_NOM[key] : this.tarifKwh;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  ngOnInit(): void {
    this.initForms();
    this.loadAll();
    this.clockInterval = setInterval(() => { this.currentTime = new Date(); }, 1000);
    this.messages = [{
      role:    'assistant',
      content: 'Bonjour ! Je suis l\'assistant IA de Wicmic Energy. Posez-moi vos questions sur vos consommations, alertes ou équipements.',
      time:    new Date(),
    }];
  }

  ngOnDestroy(): void { clearInterval(this.clockInterval); }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════

  get nowIso():      string  { return new Date().toISOString().slice(0, 16); }
  get todayDate():   string  { return new Date().toISOString().slice(0, 10); }
  get currentYear(): number  { return new Date().getFullYear(); }

  // ══════════════════════════════════════════════════════════════════════════
  // ✅ Filtre global par date
  // ══════════════════════════════════════════════════════════════════════════

  onDateFilterChange(): void {
    this.dateQuickPeriod = '';
  }

  setDateQuick(period: string): void {
    this.dateQuickPeriod = period;
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    if (period === 'all') {
      this.dateFilterFrom = '';
      this.dateFilterTo   = '';
      return;
    }
    this.dateFilterTo = toStr;
    if (period === '7j') {
      const from = new Date(today); from.setDate(from.getDate() - 7);
      this.dateFilterFrom = from.toISOString().slice(0, 10);
    } else if (period === '30j') {
      const from = new Date(today); from.setDate(from.getDate() - 30);
      this.dateFilterFrom = from.toISOString().slice(0, 10);
    } else if (period === '90j') {
      const from = new Date(today); from.setDate(from.getDate() - 90);
      this.dateFilterFrom = from.toISOString().slice(0, 10);
    } else if (period === 'ytd') {
      this.dateFilterFrom = `${today.getFullYear()}-01-01`;
    }
  }

  resetDateFilter(): void {
    this.dateFilterFrom  = '';
    this.dateFilterTo    = '';
    this.dateQuickPeriod = '';
  }

  /** Mesures filtrées par la plage de dates globale */
  get mesuresFiltreesParDate(): Mesure[] {
    return this.mesures.filter(m => {
      const d = new Date(m.dateMesure);
      if (this.dateFilterFrom && d < new Date(this.dateFilterFrom)) return false;
      if (this.dateFilterTo   && d > new Date(this.dateFilterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  /** Alertes filtrées par la plage de dates globale */
  get alertesFiltreesParDate(): AlerteExt[] {
    return this.alertes.filter(a => {
      const d = new Date(a.dateCreation);
      if (this.dateFilterFrom && d < new Date(this.dateFilterFrom)) return false;
      if (this.dateFilterTo   && d > new Date(this.dateFilterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  /** Label lisible de la plage sélectionnée */
  get dateRangeLabel(): string {
    if (!this.dateFilterFrom && !this.dateFilterTo) return 'Toutes les données';
    const fmt = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    if (this.dateFilterFrom && this.dateFilterTo) return `${fmt(this.dateFilterFrom)} → ${fmt(this.dateFilterTo)}`;
    if (this.dateFilterFrom) return `Depuis le ${fmt(this.dateFilterFrom)}`;
    return `Jusqu'au ${fmt(this.dateFilterTo)}`;
  }

  /** Coût total sur la période filtrée */
  get coutPeriodeFiltree(): number {
    return +(this.mesuresFiltreesParDate
      .reduce((s, m) => s + m.valeur * this.getTarifById(Number(m.energieId)), 0)
    ).toFixed(2);
  }

  /** Statistiques sur la période filtrée */
  get moyenneMesuresFiltrees(): number {
    const mf = this.mesuresFiltreesParDate;
    if (!mf.length) return 0;
    return +(mf.reduce((s, m) => s + m.valeur, 0) / mf.length).toFixed(1);
  }

  get maxMesureFiltre(): number {
    const mf = this.mesuresFiltreesParDate;
    return mf.length ? +Math.max(...mf.map(m => m.valeur)).toFixed(1) : 0;
  }

  get minMesureFiltre(): number {
    const mf = this.mesuresFiltreesParDate;
    return mf.length ? +Math.min(...mf.map(m => m.valeur)).toFixed(1) : 0;
  }

  /** Total pour une énergie sur la période filtrée */
  getEnergieTotalFiltre(energieId: number): number {
    return +(this.mesuresFiltreesParDate
      .filter(m => Number(m.energieId) === Number(energieId))
      .reduce((s, m) => s + m.valeur, 0)
    ).toFixed(1);
  }

  /** % pour une énergie sur la période filtrée */
  getEnergiePctFiltre(energieId: number): number {
    const total = this.mesuresFiltreesParDate.reduce((s, m) => s + m.valeur, 0) || 1;
    return Math.round((this.getEnergieTotalFiltre(energieId) / total) * 100);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ✅ Exports Excel (XLSX via SheetJS-style CSV avec extension .xlsx)
  //    ou export CSV simple renommé .xlsx selon l'environnement.
  //    Pour un vrai XLSX, remplacer par la lib xlsx/exceljs.
  // ══════════════════════════════════════════════════════════════════════════

  /** Export rapport principal (mesures filtrées) */
  exportRapportExcel(): void {
    const headers = ['ID','Date','Valeur','Unité','Énergie','Équipement','Source','Commentaire','Coût (DT)'];
    const rows = this.mesuresFiltreesParDate.map(m => [
      m.idMesure,
      new Date(m.dateMesure).toLocaleString('fr-FR'),
      m.valeur,
      this.getEnergieUnite(Number(m.energieId)),
      this.getEnergieNom(Number(m.energieId)),
      m.equipement?.nom || '—',
      m.sourceDonnee,
      m.commentaire || '',
      (m.valeur * this.getTarifById(Number(m.energieId))).toFixed(2),
    ]);
    const summary = [
      [],
      ['RÉSUMÉ'],
      ['Période', this.dateRangeLabel],
      ['Nombre de mesures', this.mesuresFiltreesParDate.length],
      ['Coût total (DT)', this.coutPeriodeFiltree],
      ['Moyenne', this.moyenneMesuresFiltrees],
      ['Maximum', this.maxMesureFiltre],
      ['Minimum', this.minMesureFiltre],
      ['Score efficacité', `${this.efficiencyScore}/100 (${this.efficiencyGrade})`],
    ];
    const csv = [[...headers], ...rows, ...summary].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `rapport_mesures_wicmic_${new Date().toISOString().slice(0,10)}.xlsx`, 'text/csv');
    this.showToast('Export Excel rapport téléchargé.', 'success');
  }

  /** Export brut des mesures filtrées */
  exportMesuresExcel(): void {
    const headers = ['ID','Date','Valeur','Unité','Énergie','Équipement','Source','Commentaire'];
    const rows = this.mesuresFiltreesParDate.map(m => [
      m.idMesure,
      new Date(m.dateMesure).toLocaleString('fr-FR'),
      m.valeur,
      this.getEnergieUnite(Number(m.energieId)),
      this.getEnergieNom(Number(m.energieId)),
      m.equipement?.nom || '—',
      m.sourceDonnee,
      m.commentaire || '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `mesures_brut_wicmic_${new Date().toISOString().slice(0,10)}.xlsx`, 'text/csv');
    this.showToast('Export mesures Excel téléchargé.', 'success');
  }

  /** Export équipements */
  exportEquipementsExcel(): void {
    const headers = ['ID','Nom','Type','Statut','Puissance (kW)','Localisation','Énergie','Date installation','Âge','Nb mesures'];
    const rows = this.equipements.map(e => [
      e.idEquipement,
      e.nom,
      e.typeEquipement,
      e.statut || 'Actif',
      e.puissance || '—',
      e.localisation || e.zone?.nom || '—',
      e.energie?.nom || (e.energieId ? this.getEnergieNom(Number(e.energieId)) : '—'),
      (e.dateMiseEnService || e.dateInstallation)
        ? new Date((e.dateMiseEnService || e.dateInstallation)!).toLocaleDateString('fr-FR')
        : '—',
      this.getEquipAgeAns(e),
      this.getMesuresForEquip(e),
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `equipements_wicmic_${new Date().toISOString().slice(0,10)}.xlsx`, 'text/csv');
    this.showToast('Export équipements Excel téléchargé.', 'success');
  }

  /** Export alertes filtrées */
  exportAlertesExcel(): void {
    const headers = ['ID','Type','Sévérité','Message','Seuil','Source','Statut','Date'];
    const rows = this.alertesFiltreesParDate.map(a => [
      a.idAlerte,
      a.type,
      a.severite,
      a.message,
      a.seuil,
      a.sourceAuto ? 'Auto' : 'Manuel',
      a.traite ? 'Traitée' : 'Active',
      new Date(a.dateCreation).toLocaleString('fr-FR'),
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `alertes_wicmic_${new Date().toISOString().slice(0,10)}.xlsx`, 'text/csv');
    this.showToast('Export alertes Excel téléchargé.', 'success');
  }

  /** Export benchmark */
  exportBenchmarkExcel(): void {
    const headers = ['Énergie','Unité','Mois courant','Mois précédent','Variation (%)','Position','Insight'];
    const rows = this.benchmarkData.map(b => [
      b.energie, b.unite, b.moisActuel, b.moisPrecedent,
      b.moisPrecedent > 0 ? b.variation : '—',
      b.position === 'better' ? 'Baisse' : b.position === 'same' ? 'Stable' : 'Hausse',
      b.insight,
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `benchmark_wicmic_${new Date().toISOString().slice(0,10)}.xlsx`, 'text/csv');
    this.showToast('Export benchmark Excel téléchargé.', 'success');
  }

  /** Export prévisions IA */
  exportPrevisionsExcel(): void {
    const headers = ['Énergie','Valeur prévue','Unité','Tendance','Variation (%)','Fiabilité (%)'];
    const rows = [
      [NOM_ELECTRICITE, this.previsionMoisProchain.elec, this.getEnergieUnite(this.idElec),
       this.previsionMoisProchain.elecTrend, this.previsionMoisProchain.elecVar, this.previsionMoisProchain.fiabilite],
      [NOM_EAU,         this.previsionMoisProchain.eau,    this.getEnergieUnite(this.idEau),    'flat', '—', this.previsionMoisProchain.fiabilite],
      [NOM_GAZOIL,      this.previsionMoisProchain.gazoil, this.getEnergieUnite(this.idGazoil), 'flat', '—', this.previsionMoisProchain.fiabilite],
    ];
    const summary: (string|number)[][] = [
      [],
      ['Période de prévision', 'Mois prochain'],
      ['Fiabilité globale (%)', this.previsionMoisProchain.fiabilite],
      ['Généré le', new Date().toLocaleString('fr-FR')],
    ];
    const csv = [headers, ...rows, ...summary].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `previsions_ia_wicmic_${new Date().toISOString().slice(0,10)}.xlsx`, 'text/csv');
    this.showToast('Export prévisions Excel téléchargé.', 'success');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Permissions
  // ══════════════════════════════════════════════════════════════════════════

  get canEdit(): boolean {
    const role = this.currentUser?.role ?? '';
    return ['responsable_energie', 'administrateur', 'responsable_electricite',
            'responsable_eau', 'responsable_gaz'].includes(role);
  }

  get userRoleLabel(): string {
    const labels: Record<string, string> = {
      'administrateur':          'Administrateur',
      'responsable_energie':     'Resp. Énergie',
      'responsable_eau':         'Resp. Eau',
      'responsable_gaz':         'Resp. Gaz',
      'responsable_electricite': 'Resp. Électricité',
      'employe':                 'Employé',
    };
    return labels[this.currentUser?.role ?? ''] ?? 'Utilisateur';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Forms
  // ══════════════════════════════════════════════════════════════════════════

  private initForms(): void {
    this.mesureForm = this.fb.group({
      valeur:       ['', [Validators.required, Validators.min(0)]],
      dateMesure:   [new Date().toISOString().slice(0, 16), Validators.required],
      sourceDonnee: ['Saisie manuelle', Validators.required],
      energieId:    ['', Validators.required],
      equipementId: [''],
      commentaire:  [''],
    });
    this.equipementForm = this.fb.group({
      nom:              ['', [Validators.required, Validators.minLength(2)]],
      typeEquipement:   ['', Validators.required],
      statut:           ['Actif', Validators.required],
      puissance:        ['', [Validators.required, Validators.min(0)]],
      localisation:     ['', Validators.required],
      dateInstallation: ['', Validators.required],
      energieId:        [''],
      zoneId:           [''],
      description:      [''],
    });
    this.seuilForm = this.fb.group({
      energieId:   ['', Validators.required],
      periode:     ['Mensuel', Validators.required],
      valeurCible: ['', [Validators.required, Validators.min(1)]],
      annee:       [new Date().getFullYear(), Validators.required],
    });
    this.alerteForm = this.fb.group({
      type:      ['Dépassement seuil', Validators.required],
      severite:  ['Normale', Validators.required],
      message:   ['', Validators.required],
      seuil:     [''],
      energieId: [''],
    });
    this.anomalieForm = this.fb.group({
      type:          ['Pic de consommation', Validators.required],
      energieId:     [''],
      description:   ['', Validators.required],
      dateDetection: [new Date().toISOString().slice(0, 10), Validators.required],
      equipementId:  [''],
    });
    this.recoForm = this.fb.group({
      titre:       ['', Validators.required],
      description: ['', Validators.required],
      priorite:    ['Moyenne', Validators.required],
      economie:    [0, Validators.min(0)],
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Normalisation
  // ══════════════════════════════════════════════════════════════════════════

  private normalizeEnergie(e: any): Energie {
    return {
      idEnergie:    e.idEnergie    ?? e.IdEnergie    ?? 0,
      nom:          e.nom          ?? e.Nom          ?? '',
      unite:        e.unite        ?? e.Unite        ?? '',
      dateCreation: e.dateCreation ?? e.DateCreation ?? new Date().toISOString(),
    } as Energie;
  }

  private normalizeMesure(m: any): Mesure {
    const energieRaw   = m.energie    ?? m.Energie    ?? null;
    const equipRaw     = m.equipement ?? m.Equipement ?? null;
    const energieId    = m.energieId    ?? m.EnergieId    ?? energieRaw?.idEnergie ?? energieRaw?.IdEnergie    ?? 0;
    const equipementId = m.equipementId ?? m.EquipementId ?? equipRaw?.idEquipement ?? equipRaw?.IdEquipement ?? null;
    return {
      idMesure:     m.idMesure     ?? m.IdMesure    ?? 0,
      valeur:       +(m.valeur     ?? m.Valeur      ?? 0),
      dateMesure:   m.dateMesure   ?? m.DateMesure  ?? new Date().toISOString(),
      dateCreation: m.dateCreation ?? m.DateCreation ?? new Date().toISOString(),
      sourceDonnee: m.sourceDonnee ?? m.SourceDonnee ?? '',
      energieId,
      energie:      energieRaw ? this.normalizeEnergie(energieRaw) : null,
      equipementId,
      equipement:   equipRaw ?? null,
      commentaire:  m.commentaire  ?? m.Commentaire  ?? '',
    } as Mesure;
  }

  private normalizeEquipement(e: any): Equipement {
    const energieRaw = e.energie ?? e.Energie ?? null;
    const energieId  = e.energieId ?? e.EnergieId ?? energieRaw?.idEnergie ?? energieRaw?.IdEnergie ?? null;
    return {
      idEquipement:      e.idEquipement     ?? e.IdEquipement      ?? 0,
      nom:               e.nom              ?? e.Nom               ?? '',
      typeEquipement:    e.typeEquipement   ?? e.TypeEquipement    ?? '',
      statut:            e.statut           ?? e.Statut            ?? 'Actif',
      puissance:         +(e.puissance      ?? e.Puissance         ?? 0),
      localisation:      e.localisation     ?? e.Localisation      ?? '',
      dateMiseEnService: e.dateMiseEnService ?? e.DateMiseEnService ?? null,
      dateInstallation:  e.dateInstallation  ?? e.DateInstallation  ?? null,
      energieId,
      zoneId:  e.zoneId  ?? e.ZoneId  ?? null,
      energie: energieRaw ? this.normalizeEnergie(energieRaw) : null,
      zone:    e.zone    ?? e.Zone    ?? null,
    } as Equipement;
  }

  private normalizeAlerte(a: any): AlerteExt {
    return {
      idAlerte:     a.idAlerte     ?? a.IdAlerte     ?? 0,
      type:         a.type         ?? a.Type         ?? '',
      message:      a.message      ?? a.Message      ?? '',
      seuil:        +(a.seuil      ?? a.Seuil        ?? 0),
      severite:     a.severite     ?? a.Severite     ?? 'Normale',
      traite:       a.traite       ?? a.Traite       ?? false,
      dateCreation: a.dateCreation ?? a.DateCreation ?? new Date().toISOString(),
      sourceAuto:   a.sourceAuto   ?? a.SourceAuto   ?? false,
    };
  }

  private normalizeAnomalie(a: any): AnomalieExt {
    const energieId  = a.energieId ?? a.EnergieId ?? null;
    const energieNom = energieId ? this.getEnergieNom(energieId) : (a.energieNom ?? a.EnergiNom ?? '');
    return {
      id:            a.id            ?? a.idAnomalie ?? a.IdAnomalie ?? 0,
      description:   a.description   ?? a.Description   ?? '',
      dateDetection: a.dateDetection ?? a.DateDetection ?? new Date().toISOString(),
      resolu:        a.resolu        ?? a.Resolu        ?? false,
      type:          a.type          ?? a.Type          ?? 'Anomalie',
      energieNom,
      energieId,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Seuils
  // ══════════════════════════════════════════════════════════════════════════

  private syncSeuilsActuelles(): void {
    this.seuilsList = this.seuilsList.map(s => ({
      ...s, valeurActuelle: this.getEnergieTotal(s.energieId),
    }));
    this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
  }

  private initSeuilsFromEnergies(): void {
    if (!this.energies.length) return;
    if (this.seuilsList.length === 0) {
      this.seuilsList = this.energies.map((e, i) => ({
        id:             i + 1,
        energieId:      Number(e.idEnergie),
        nom:            e.nom,
        periode:        'Mensuel',
        annee:          new Date().getFullYear(),
        valeurCible:    0,
        valeurActuelle: this.getEnergieTotal(Number(e.idEnergie)),
        unite:          e.unite,
      }));
    } else {
      this.seuilsList = this.seuilsList.map(s => {
        const en = this.energies.find(e => Number(e.idEnergie) === s.energieId);
        return { ...s, nom: en?.nom ?? s.nom, unite: en?.unite ?? s.unite, valeurActuelle: this.getEnergieTotal(s.energieId) };
      });
    }
    this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
  }

  openSeuilModal(seuil?: Seuil): void {
    this.editingSeuil = seuil ?? null;
    this.seuilSaved   = false;
    if (seuil) {
      this.seuilForm.patchValue({ energieId: seuil.energieId, periode: seuil.periode, valeurCible: seuil.valeurCible, annee: seuil.annee });
    } else {
      this.seuilForm.reset({ periode: 'Mensuel', annee: new Date().getFullYear() });
    }
    this.showSeuilModal = true;
  }

  editSeuil(s: Seuil): void { this.openSeuilModal(s); }

  deleteSeuil(s: Seuil): void {
    const idx = this.seuilsList.findIndex(x => x.id === s.id);
    if (idx >= 0) {
      this.seuilsList[idx] = { ...this.seuilsList[idx], valeurCible: 0 };
      this.seuilsList = [...this.seuilsList];
      this.seuilsHistorique = this.seuilsList.filter(x => x.valeurCible > 0);
      this.showToast('Seuil supprimé.', 'info');
    }
  }

  get seuilElec():   number { return this.seuilsList.find(s => s.energieId === this.idElec)?.valeurCible ?? 0; }
  get seuilGazoil(): number { return this.seuilsList.find(s => s.energieId === this.idGazoil)?.valeurCible ?? 0; }
  get seuilEau():    number { return this.seuilsList.find(s => s.energieId === this.idEau)?.valeurCible ?? 0; }

  get consommationElec():   number { return this.getEnergieTotal(this.idElec); }
  get consommationGazoil(): number { return this.getEnergieTotal(this.idGazoil); }
  get consommationEau():    number { return this.getEnergieTotal(this.idEau); }

  getSeuilPct(s: Seuil): number {
    if (!s.valeurCible) return 0;
    return Math.round((s.valeurActuelle / s.valeurCible) * 100);
  }
  isSeuilDefini(s: Seuil): boolean { return s.valeurCible > 0; }

  get seuilsDefinis():  number { return this.seuilsList.filter(s => s.valeurCible > 0).length; }
  get seuilsAtteints(): number { return this.seuilsList.filter(s => s.valeurCible > 0 && this.getSeuilPct(s) <= 100).length; }
  get seuilsTotal():    number { return this.seuilsList.length; }
  get seuilsEnCours():  number { return this.seuilsList.filter(s => { const p = this.getSeuilPct(s); return p > 0 && p <= 100; }).length; }
  get seuilsDepasses(): number { return this.seuilsList.filter(s => s.valeurCible > 0 && this.getSeuilPct(s) > 100).length; }
  get tauxSeuil(): number {
    const d = this.seuilsDefinis; if (!d) return 0;
    return Math.round((this.seuilsAtteints / d) * 100);
  }

  saveSeuil(): void {
    if (this.seuilForm.invalid) { this.seuilForm.markAllAsTouched(); return; }
    this.seuilSaving = true;
    const v = this.seuilForm.value;
    const energieId = +v.energieId;

    if (this.editingSeuil) {
      const idx = this.seuilsList.findIndex(s => s.id === this.editingSeuil!.id);
      if (idx >= 0) {
        this.seuilsList[idx] = { ...this.seuilsList[idx], energieId, nom: this.getEnergieNom(energieId), periode: v.periode, annee: +v.annee, valeurCible: +v.valeurCible, valeurActuelle: this.getEnergieTotal(energieId), unite: this.getEnergieUnite(energieId) };
        this.seuilsList = [...this.seuilsList];
      }
    } else {
      const existing = this.seuilsList.findIndex(s => s.energieId === energieId);
      const newSeuil: Seuil = { id: existing >= 0 ? this.seuilsList[existing].id : Date.now(), energieId, nom: this.getEnergieNom(energieId), periode: v.periode, annee: +v.annee, valeurCible: +v.valeurCible, valeurActuelle: this.getEnergieTotal(energieId), unite: this.getEnergieUnite(energieId) };
      if (existing >= 0) this.seuilsList[existing] = newSeuil;
      else               this.seuilsList = [...this.seuilsList, newSeuil];
    }
    this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);

    setTimeout(() => {
      this.seuilSaving = false; this.seuilSaved = true; this.editingSeuil = null;
      this.showToast('Seuil enregistré !', 'success');
      setTimeout(() => { this.seuilSaved = false; this.showSeuilModal = false; }, 1400);
    }, 500);
  }

  exportSeuilsCSV(): void {
    const headers = ['Énergie','Période','Année','Seuil cible','Consommation','%','Statut'];
    const rows = this.seuilsHistorique.map(s => {
      const pct = this.getSeuilPct(s);
      return [s.nom, s.periode, s.annee, `${s.valeurCible} ${s.unite}`, `${s.valeurActuelle} ${s.unite}`, `${pct}%`, pct <= 80 ? 'OK' : pct <= 100 ? 'Attention' : 'Dépassé'];
    });
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `seuils_wicmic_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    this.showToast('Export seuils CSV téléchargé.', 'success');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Modal Mesure
  // ══════════════════════════════════════════════════════════════════════════

  openAddMesure(): void {
    this.mesureForm.reset({ sourceDonnee: 'Saisie manuelle', dateMesure: new Date().toISOString().slice(0,16) });
    this.mesureSaved = false; this.showMesureModal = true;
  }
  resetMesureForm(): void { this.mesureForm.reset({ sourceDonnee: 'Saisie manuelle', dateMesure: new Date().toISOString().slice(0,16) }); }

  saveMesure(): void {
    if (this.mesureForm.invalid) { this.mesureForm.markAllAsTouched(); return; }
    this.mesureSaving = true;
    this.api.createMesure(this.mesureForm.value).subscribe({
      next: () => {
        this.mesureSaving = false; this.mesureSaved = true;
        this.showToast('Mesure enregistrée !', 'success');
        setTimeout(() => { this.mesureSaved = false; this.showMesureModal = false; this.loadAll(); }, 1400);
      },
      error: () => { this.mesureSaving = false; this.showToast('Erreur lors de la sauvegarde.', 'error'); },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Modal Alerte
  // ══════════════════════════════════════════════════════════════════════════

  openAlerteModal(): void {
    this.alerteForm.reset({ type: 'Dépassement seuil', severite: 'Normale' });
    this.alerteSaved = false; this.showAlerteModal = true;
  }

  saveAlerte(): void {
    if (this.alerteForm.invalid) { this.alerteForm.markAllAsTouched(); return; }
    this.alerteSaving = true;
    const v = this.alerteForm.value;
    const a: AlerteExt = { idAlerte: Date.now(), type: v.type, severite: v.severite, message: v.message, seuil: +(v.seuil)||0, traite: false, dateCreation: new Date().toISOString(), sourceAuto: false };
    setTimeout(() => {
      this.alertes = [a, ...this.alertes]; this.alerteSaving = false; this.alerteSaved = true;
      this.showToast('Alerte créée !', 'success');
      setTimeout(() => { this.alerteSaved = false; this.showAlerteModal = false; }, 1400);
    }, 500);
  }

  deleteAlerte(a: AlerteExt): void {
    this.alertes = this.alertes.filter(x => x.idAlerte !== a.idAlerte);
    this.showToast('Alerte supprimée.', 'info');
  }

  genererAlertesAuto(): void {
    let count = 0;
    this.seuilsList.forEach(s => {
      if (!s.valeurCible || this.getSeuilPct(s) <= 100) return;
      const existe = this.alertes.some(a => a.sourceAuto && !a.traite && a.message.includes(s.nom));
      if (existe) return;
      const alerte: AlerteExt = {
        idAlerte:     Date.now() + Math.random(),
        type:         'Dépassement seuil',
        severite:     this.getSeuilPct(s) > 130 ? 'Critique' : 'Haute',
        message:      `Seuil ${s.nom} dépassé : ${s.valeurActuelle} ${s.unite} / ${s.valeurCible} ${s.unite} (${this.getSeuilPct(s)}%)`,
        seuil:        s.valeurCible,
        traite:       false,
        dateCreation: new Date().toISOString(),
        sourceAuto:   true,
      };
      this.alertes = [alerte, ...this.alertes]; count++;
    });
    this.alertesAutoGenerees = count;
    if (count > 0) {
      this.showToast(`${count} alerte(s) automatique(s) générée(s).`, 'warn');
    } else { this.showToast('Aucun nouveau seuil dépassé.', 'info'); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Modal Anomalie
  // ══════════════════════════════════════════════════════════════════════════

  openAnomalieModal(): void {
    this.anomalieForm.reset({ type: 'Pic de consommation', dateDetection: new Date().toISOString().slice(0,10) });
    this.anomalieSaved = false; this.showAnomalieModal = true;
  }

  saveAnomalie(): void {
    if (this.anomalieForm.invalid) { this.anomalieForm.markAllAsTouched(); return; }
    this.anomalieSaving = true;
    const v = this.anomalieForm.value;
    const energieId = v.energieId ? +v.energieId : null;
    const a: AnomalieExt = { id: Date.now(), description: v.description, dateDetection: v.dateDetection, resolu: false, type: v.type, energieNom: energieId ? this.getEnergieNom(energieId) : '', energieId };
    setTimeout(() => {
      this.anomalies = [a, ...this.anomalies]; this.progressMap.set(a.id, 0);
      this.anomalieSaving = false; this.anomalieSaved = true;
      this.showToast('Anomalie signalée !', 'success');
      setTimeout(() => { this.anomalieSaved = false; this.showAnomalieModal = false; }, 1400);
    }, 500);
  }

  deleteAnomalie(a: AnomalieExt): void {
    this.anomalies = this.anomalies.filter(x => x.id !== a.id);
    this.progressMap.delete(a.id);
    this.showToast('Anomalie supprimée.', 'info');
  }

  get anomalieTypes(): string[] {
    return ['Pic de consommation','Chute de production','Fuite détectée','Équipement défaillant','Mesure aberrante','Autre'];
  }

  get tauxResolutionAnomalies(): number {
    if (!this.anomalies.length) return 0;
    return Math.round((this.anomalies.filter(a => a.resolu).length / this.anomalies.length) * 100);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recommandation modal
  // ══════════════════════════════════════════════════════════════════════════

  openRecoModal(): void {
    this.recoForm.reset({ priorite: 'Moyenne', economie: 0 });
    this.recoSaved = false; this.showRecoModal = true;
  }

  saveReco(): void {
    if (this.recoForm.invalid) { this.recoForm.markAllAsTouched(); return; }
    this.recoSaving = true;
    const v = this.recoForm.value;
    const newReco: any = { idRecommandation: Date.now(), titre: v.titre, description: v.description, priorite: v.priorite, economie: +v.economie || 0, applique: false, dateCreation: new Date().toISOString() };
    setTimeout(() => {
      this.recommandations = [newReco, ...this.recommandations];
      this.recoSaving = false; this.recoSaved = true;
      this.showToast('Recommandation ajoutée !', 'success');
      setTimeout(() => { this.recoSaved = false; this.showRecoModal = false; }, 1400);
    }, 500);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // KPIs
  // ══════════════════════════════════════════════════════════════════════════

  get totalMesures()         { return this.mesures.length; }
  get alertesNonTraitees()   { return this.alertes.filter(a => !a.traite).length; }
  get anomaliesNonResolues() { return this.anomalies.filter(a => !a.resolu).length; }
  get totalRecommandations() { return this.recommandations.length; }
  get recoAppliquees()       { return this.recommandations.filter(r => r.applique).length; }
  get recoHautePriorite()    { return this.recommandations.filter(r => r.priorite === 'Haute').length; }
  get equipementsActifs()    { return this.equipements.filter(e => !e.statut || e.statut === 'Actif').length; }
  get equipementsMaintenance() { return this.equipements.filter(e => e.statut === 'Maintenance').length; }
  get equipementsInactifs()  { return this.equipements.filter(e => e.statut === 'Inactif').length; }
  get puissanceTotale(): number { return this.equipements.reduce((s, e) => s + (e.puissance || 0), 0); }

  get derniereMesure(): number {
    if (!this.mesures.length) return 0;
    return +[...this.mesures].sort((a, b) => new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime())[0].valeur.toFixed(1);
  }
  get moyenneMesures(): number {
    if (!this.mesures.length) return 0;
    return +(this.mesures.reduce((s, m) => s + m.valeur, 0) / this.mesures.length).toFixed(1);
  }
  get maxMesure(): number { return this.mesures.length ? +Math.max(...this.mesures.map(m => m.valeur)).toFixed(1) : 0; }
  get minMesure(): number { return this.mesures.length ? +Math.min(...this.mesures.map(m => m.valeur)).toFixed(1) : 0; }

  get coutTotal(): number {
    return +(this.mesures.reduce((s, m) => s + m.valeur * this.getTarifById(Number(m.energieId)), 0)).toFixed(2);
  }

  get coutMoisCourant(): number {
    const now = new Date();
    const mois = this.mesures.filter(m => { const d = new Date(m.dateMesure); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    return +(mois.reduce((s, m) => s + m.valeur * this.getTarifById(Number(m.energieId)), 0)).toFixed(2);
  }

  get mesuresAujourd(): number {
    const today = new Date().toDateString();
    return this.mesures.filter(m => new Date(m.dateMesure).toDateString() === today).length;
  }
  get mesuresSemaine(): number {
    const debut = new Date(); debut.setDate(debut.getDate() - 7);
    return this.mesures.filter(m => new Date(m.dateMesure) >= debut).length;
  }

  get tendanceMois(): 'up'|'down'|'flat' {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const curr = new Date(now.getFullYear(), now.getMonth(), 1);
    const cVal = this.mesures.filter(m => new Date(m.dateMesure) >= curr).reduce((s, m) => s + m.valeur, 0);
    const pVal = this.mesures.filter(m => { const d = new Date(m.dateMesure); return d >= prev && d < curr; }).reduce((s, m) => s + m.valeur, 0);
    if (!pVal || !cVal) return 'flat';
    const diff = ((cVal - pVal) / pVal) * 100;
    return diff > 3 ? 'up' : diff < -3 ? 'down' : 'flat';
  }

  get variationMois(): string {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const curr = new Date(now.getFullYear(), now.getMonth(), 1);
    const cVal = this.mesures.filter(m => new Date(m.dateMesure) >= curr).reduce((s, m) => s + m.valeur, 0);
    const pVal = this.mesures.filter(m => { const d = new Date(m.dateMesure); return d >= prev && d < curr; }).reduce((s, m) => s + m.valeur, 0);
    if (!pVal || !cVal) return '—';
    return Math.abs(((cVal - pVal) / pVal) * 100).toFixed(1);
  }

  get tendance(): 'up'|'down'|'stable' {
    if (this.mesures.length < 2) return 'stable';
    const sorted = [...this.mesures].sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    const last = sorted[sorted.length - 1].valeur;
    const prev = sorted[sorted.length - 2].valeur;
    return last > prev * 1.05 ? 'up' : last < prev * 0.95 ? 'down' : 'stable';
  }
  get tendancePct(): string {
    if (this.mesures.length < 2) return '0';
    const sorted = [...this.mesures].sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    const last = sorted[sorted.length - 1].valeur;
    const prev = sorted[sorted.length - 2].valeur;
    if (!prev) return '0';
    return Math.abs(((last - prev) / prev) * 100).toFixed(1);
  }

  get economieObjectif(): number {
    const currTotal = this.mesures.filter(m => { const d = new Date(m.dateMesure); const now = new Date(); return d.getMonth() === now.getMonth(); }).reduce((s, m) => s + m.valeur, 0);
    return +(currTotal * (this.objectifReductionPct / 100) * this.tarifKwh).toFixed(2);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Score d'efficacité
  // ══════════════════════════════════════════════════════════════════════════

  get efficiencyScore(): number {
    if (!this.mesures.length) return 0;
    let score = 100;
    score -= this.alertesCritiques * 12;
    score -= this.anomaliesNonResolues * 6;
    score -= this.seuilsDepasses * 10;
    if (this.tendanceMois === 'up')   score -= 8;
    if (this.tendanceMois === 'down') score += 5;
    if (this.equipementsMaintenance === 0 && this.equipements.length > 0) score += 5;
    const recoBonus = Math.min(10, this.recoAppliquees * 2);
    score += recoBonus;
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  get hasEfficiencyData(): boolean { return this.mesures.length > 0; }

  get efficiencyGrade(): string {
    const s = this.efficiencyScore;
    if (s >= 90) return 'A+'; if (s >= 80) return 'A'; if (s >= 70) return 'B';
    if (s >= 60) return 'C'; if (s >= 50) return 'D'; return 'F';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Energie helpers
  // ══════════════════════════════════════════════════════════════════════════

  getEnergieTotal(energieId: number): number {
    return +(this.mesures.filter(m => Number(m.energieId) === Number(energieId)).reduce((s, m) => s + (m.valeur ?? 0), 0).toFixed(1));
  }

  getEnergieCout(energieId: number): number {
    return +(this.getEnergieTotal(energieId) * this.getTarifById(energieId)).toFixed(2);
  }

  getEnergiePct(energieId: number): number {
    const total = this.mesures.reduce((s, m) => s + m.valeur, 0) || 1;
    return Math.round((this.getEnergieTotal(energieId) / total) * 100);
  }
  getEnergieUnite(energieId: number): string {
    const e = this.energies.find(e => Number(e.idEnergie) === Number(energieId));
    if (e?.unite) return e.unite;
    for (const m of this.mesures) { if (Number(m.energieId) === Number(energieId) && m.energie?.unite) return m.energie.unite; }
    return 'unité';
  }
  getEnergieNom(energieId: number): string {
    if (!energieId) return '—';
    const found = this.energies.find(e => Number(e.idEnergie) === Number(energieId));
    if (found?.nom) return found.nom;
    for (const m of this.mesures) { if (Number(m.energieId) === Number(energieId) && m.energie?.nom) return m.energie.nom; }
    return `Énergie ${energieId}`;
  }
  getEnergieIcon(energieId: number): string {
    const nom = this.getEnergieNom(energieId).toLowerCase();
    if (nom.includes('elec') || nom.includes('électr')) return '⚡';
    if (nom.includes('eau')  || nom.includes('water'))  return '💧';
    if (nom.includes('gazoil'))                          return '🛢️';
    if (nom.includes('gaz'))                             return '🔥';
    if (nom.includes('vapeur'))                          return '♨️';
    return '🔋';
  }
  getEnergieRoute(en: Energie): string {
    const nom = (en.nom ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nom.includes('elec') || nom.includes('electr')) return 'electricity';
    if (nom.includes('eau')  || nom.includes('water'))  return 'water';
    if (nom.includes('gazoil') || nom.includes('gaz'))  return 'gas';
    if (nom.includes('vapeur'))                          return 'steam';
    return nom.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
  getEnergieNavStyle(energieId: number): Record<string, string> {
    const nom = this.getEnergieNom(energieId).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nom.includes('elec') || nom.includes('electr')) return { background: 'rgba(240,184,74,0.15)', color: '#c47f10' };
    if (nom.includes('gazoil') || nom.includes('gaz'))  return { background: 'rgba(232,112,64,0.15)',  color: '#c05c10' };
    if (nom.includes('eau') || nom.includes('water'))   return { background: 'rgba(77,201,186,0.15)',  color: '#0d9488' };
    if (nom.includes('vapeur'))                          return { background: 'rgba(232,112,110,0.15)', color: '#9a2828' };
    return { background: 'rgba(123,110,196,0.15)', color: '#7b6ec4' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Sparklines
  // ══════════════════════════════════════════════════════════════════════════

  private buildSparklines(): void {
    const now = new Date();
    this.sparklines = this.energies.map(en => {
      const points: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        const dayM = this.mesures.filter(m => Number(m.energieId) === Number(en.idEnergie) && new Date(m.dateMesure).toDateString() === d.toDateString());
        points.push(dayM.length ? +(dayM.reduce((s, m) => s + m.valeur, 0) / dayM.length).toFixed(1) : 0);
      }
      return { energieId: Number(en.idEnergie), points };
    });
  }

  getSparkPath(energieId: number): string {
    const spark = this.sparklines.find(s => s.energieId === energieId);
    if (!spark || spark.points.every(p => p === 0)) return '';
    const pts = spark.points;
    const maxV = Math.max(...pts, 1);
    const W = 80; const H = 28;
    return pts.map((v, i) => {
      const x = (i / (pts.length - 1)) * W;
      const y = H - (v / maxV) * H;
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }).join(' ');
  }

  getSparkTrend(energieId: number): 'up'|'down'|'flat' {
    const spark = this.sparklines.find(s => s.energieId === energieId);
    if (!spark) return 'flat';
    const pts = spark.points.filter(p => p > 0);
    if (pts.length < 2) return 'flat';
    const last = pts[pts.length - 1]; const prev = pts[pts.length - 2];
    return last > prev * 1.05 ? 'up' : last < prev * 0.95 ? 'down' : 'flat';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Chart
  // ══════════════════════════════════════════════════════════════════════════

  get chartDays(): number { return this.chartPeriod === '7j' ? 7 : this.chartPeriod === '30j' ? 30 : 90; }

  private buildPoints(daysAgo: number): { label: string; value: number }[] {
    const now = new Date();
    return Array.from({ length: this.chartDays }, (_, i) => {
      const d = new Date(now); d.setDate(d.getDate() - (this.chartDays - 1 - i) - daysAgo);
      const label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const dayM  = this.mesures.filter(m => new Date(m.dateMesure).toDateString() === d.toDateString());
      const val   = dayM.length ? +(dayM.reduce((s, m) => s + m.valeur, 0) / dayM.length).toFixed(1) : 0;
      return { label, value: val };
    });
  }

  private toChartPoints(raw: { label: string; value: number }[], maxVal: number): ChartPoint[] {
    const W = this.CHART_W - this.CHART_PAD_X * 2;
    const H = this.CHART_H - this.CHART_PAD_Y * 2;
    return raw.map((p, i) => ({
      ...p,
      x: this.CHART_PAD_X + (i / Math.max(raw.length - 1, 1)) * W,
      y: this.CHART_PAD_Y + H - ((p.value / maxVal) * H),
    }));
  }

  get chartPoints(): ChartPoint[] {
    const raw = this.buildPoints(0);
    const maxVal = Math.max(...raw.map(p => p.value), this.alertThreshold, 1) * 1.15;
    return this.toChartPoints(raw, maxVal);
  }
  get chartPointsN1(): ChartPoint[] {
    const raw = this.buildPoints(this.chartDays);
    const maxVal = Math.max(...this.chartPoints.map(p => p.value), ...raw.map(p => p.value), this.alertThreshold, 1) * 1.15;
    return this.toChartPoints(raw, maxVal);
  }
  get hasChartData(): boolean { return this.chartPoints.some(p => p.value > 0); }

  private pathFromPoints(pts: ChartPoint[]): string {
    const valid = pts.filter(p => p.value > 0);
    if (!valid.length) return '';
    let d = ''; let inPath = false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].value > 0) {
        if (!inPath) { d += `M ${pts[i].x} ${pts[i].y}`; inPath = true; }
        else { const cpX = (pts[i-1].x + pts[i].x) / 2; d += ` C ${cpX} ${pts[i-1].y} ${cpX} ${pts[i].y} ${pts[i].x} ${pts[i].y}`; }
      } else { inPath = false; }
    }
    return d;
  }

  private areaFromPoints(pts: ChartPoint[]): string {
    if (!pts.length) return '';
    const bottom = this.CHART_H - this.CHART_PAD_Y;
    let d = `M ${pts[0].x} ${bottom} L ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cpX = (pts[i-1].x + pts[i].x) / 2;
      d += ` C ${cpX} ${pts[i-1].y} ${cpX} ${pts[i].y} ${pts[i].x} ${pts[i].y}`;
    }
    d += ` L ${pts[pts.length-1].x} ${bottom} Z`;
    return d;
  }

  get linePath():   string { return this.pathFromPoints(this.chartPoints); }
  get areaPath():   string { return this.areaFromPoints(this.chartPoints.filter(p => p.value > 0)); }
  get linePathN1(): string { return this.pathFromPoints(this.chartPointsN1); }

  get thresholdY(): number {
    const maxVal = Math.max(...this.chartPoints.map(p => p.value), this.alertThreshold, 1) * 1.15;
    return this.CHART_PAD_Y + (this.CHART_H - this.CHART_PAD_Y * 2) - (this.alertThreshold / maxVal) * (this.CHART_H - this.CHART_PAD_Y * 2);
  }
  get yAxisLabels(): { y: number; label: string }[] {
    const maxVal = Math.max(...this.chartPoints.map(p => p.value), this.alertThreshold, 1) * 1.15;
    const H = this.CHART_H - this.CHART_PAD_Y * 2;
    return Array.from({ length: 5 }, (_, i) => {
      const pct = i / 4;
      return { y: this.CHART_PAD_Y + H - pct * H, label: Math.round(pct * maxVal).toString() };
    });
  }
  get visibleXLabels(): ChartPoint[] {
    const pts = this.chartPoints;
    if (!pts.length) return [];
    const step = Math.max(1, Math.floor(pts.length / 6));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }
  isAboveThreshold(val: number): boolean { return val > this.alertThreshold; }

  get forecastLinePath(): string { return this.pathFromPoints(this.forecastPoints); }
  get forecastSplitX():  number  { const pts = this.chartPoints; return pts.length ? pts[pts.length - 1].x : this.CHART_W / 2; }

  private buildForecastPoints(): void {
    if (!this.previsionMoisProchain.hasEnoughData) { this.forecastPoints = []; return; }
    const now = new Date();
    const jours90: {x: number; y: number}[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const dayM = this.mesures.filter(m => new Date(m.dateMesure).toDateString() === d.toDateString());
      const avg = dayM.length ? dayM.reduce((s, m) => s + m.valeur, 0) / dayM.length : 0;
      if (avg > 0) jours90.push({ x: 90 - i, y: +avg.toFixed(1) });
    }
    const n = jours90.length; if (n < 5) { this.forecastPoints = []; return; }
    const sumX = jours90.reduce((s, p) => s + p.x, 0);
    const sumY = jours90.reduce((s, p) => s + p.y, 0);
    const sumXY = jours90.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = jours90.reduce((s, p) => s + p.x * p.x, 0);
    const a = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const b = (sumY - a * sumX) / n;
    const maxVal = Math.max(...this.chartPoints.map(p => p.value), this.alertThreshold, 1) * 1.15;
    const H = this.CHART_H - this.CHART_PAD_Y * 2;
    const startX = this.forecastSplitX;
    this.forecastPoints = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i + 1);
      const label = d.getDate() + '/' + (d.getMonth() + 1);
      const value = Math.max(0, Math.round(a * (90 + i + 1) + b));
      const x = startX + ((i + 1) / 10) * (this.CHART_W - this.CHART_PAD_X - startX);
      const y = this.CHART_PAD_Y + H - ((value / maxVal) * H);
      return { label, value, x, y };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Mesures table
  // ══════════════════════════════════════════════════════════════════════════

  get filteredMesures(): Mesure[] {
    let list = [...this.mesures].sort((a, b) => new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime());
    if (this.searchMesure) {
      const q = this.searchMesure.toLowerCase();
      list = list.filter(m => this.getEnergieNom(m.energieId).toLowerCase().includes(q) || (m.sourceDonnee||'').toLowerCase().includes(q) || (m.commentaire||'').toLowerCase().includes(q));
    }
    if (this.filterMesureEnergie) list = list.filter(m => Number(m.energieId) === Number(this.filterMesureEnergie));
    return list;
  }
  get pagedMesures(): Mesure[] { const s = (this.mesurePage - 1) * this.mesurePerPage; return this.filteredMesures.slice(s, s + this.mesurePerPage); }
  get mesureTotalPages(): number { return Math.max(1, Math.ceil(this.filteredMesures.length / this.mesurePerPage)); }
  get mesurePages():      number[] { return Array.from({ length: this.mesureTotalPages }, (_, i) => i + 1); }

  // ══════════════════════════════════════════════════════════════════════════
  // Équipements
  // ══════════════════════════════════════════════════════════════════════════

  get equipementTypes(): string[] { return [...new Set(this.equipements.map(e => e.typeEquipement))]; }

  get filteredEquipements(): Equipement[] {
    let list = [...this.equipements];
    if (this.searchEquip) {
      const q = this.searchEquip.toLowerCase();
      list = list.filter(e => e.nom.toLowerCase().includes(q) || e.typeEquipement.toLowerCase().includes(q) || (e.localisation||e.zone?.nom||'').toLowerCase().includes(q));
    }
    if (this.filterEquipType)   list = list.filter(e => e.typeEquipement === this.filterEquipType);
    if (this.filterEquipStatut) list = list.filter(e => (e.statut||'Actif') === this.filterEquipStatut);
    return list;
  }
  get pagedEquipements(): Equipement[] { const s = (this.equipPage-1)*this.equipPerPage; return this.filteredEquipements.slice(s, s+this.equipPerPage); }
  get equipTotalPages(): number { return Math.max(1, Math.ceil(this.filteredEquipements.length / this.equipPerPage)); }
  get equipPages():      number[] { return Array.from({ length: this.equipTotalPages }, (_, i) => i + 1); }

  getEquipStatutClass(statut?: string): string {
    if (statut === 'Actif' || !statut) return 'tag--success';
    if (statut === 'Maintenance')       return 'tag--warn';
    if (statut === 'Inactif')           return 'tag--danger';
    return 'tag--ghost';
  }
  getEquipIcon(type: string): string {
    const icons: Record<string, string> = { 'Compresseur':'⚙️','Pompe':'💧','CVC':'❄️','Chaudière':'🔥','Éclairage':'💡','Générateur':'⚡','Moteur':'🔧','Convoyeur':'🏭','Machine textile':'🧵','Machine packaging':'📦','Autre':'🔌' };
    return icons[type] || '🔌';
  }
  getEquipLocalisation(e: Equipement): string { return e.localisation || e.zone?.nom || '—'; }
  getEquipAgeAns(e: Equipement): string {
    const dateRef = e.dateMiseEnService || e.dateInstallation;
    if (!dateRef) return '—';
    const ans = Math.floor((Date.now() - new Date(dateRef).getTime()) / (365.25 * 86400000));
    return ans < 1 ? '< 1 an' : `${ans} an${ans > 1 ? 's' : ''}`;
  }
  getMesuresForEquip(e: Equipement): number { return this.mesures.filter(m => Number(m.equipementId) === Number(e.idEquipement)).length; }

  openAddEquipement(): void {
    this.editingEquipement = null;
    this.equipementForm.reset({ statut: 'Actif', dateInstallation: new Date().toISOString().slice(0,10) });
    this.equipementSaved = false;
    this.showEquipementModal = true;
  }

  openEditEquipement(e: Equipement): void {
    this.editingEquipement = e;
    const dateRef = e.dateMiseEnService || e.dateInstallation;
    this.equipementForm.patchValue({
      nom:              e.nom,
      typeEquipement:   e.typeEquipement,
      statut:           e.statut || 'Actif',
      puissance:        e.puissance ?? '',
      localisation:     e.localisation || e.zone?.nom || '',
      dateInstallation: dateRef ? new Date(dateRef).toISOString().slice(0,10) : '',
      energieId:        e.energieId ?? '',
      zoneId:           e.zoneId ?? '',
      description:      (e as {description?: string}).description || '',
    });
    this.equipementSaved = false;
    this.showEquipementModal = true;
  }

  saveEquipement(): void {
    if (this.equipementForm.invalid) { this.equipementForm.markAllAsTouched(); return; }
    this.equipementSaving = true;
    const v = this.equipementForm.value;

    const dto = {
      idEquipement:      this.editingEquipement?.idEquipement ?? 0,
      nom:               v.nom,
      typeEquipement:    v.typeEquipement,
      statut:            v.statut,
      puissance:         v.puissance ? +v.puissance : null,
      localisation:      v.localisation,
      dateMiseEnService: v.dateInstallation ? new Date(v.dateInstallation).toISOString() : null,
      dateInstallation:  v.dateInstallation ? new Date(v.dateInstallation).toISOString() : null,
      energieId:         v.energieId  ? +v.energieId  : null,
      zoneId:            v.zoneId     ? +v.zoneId     : null,
      description:       v.description ?? '',
      zone:              null,
      energie:           null,
      mesures:           [],
      alertes:           [],
    };

    const obs$ = this.editingEquipement
      ? this.api.updateEquipement(this.editingEquipement.idEquipement, dto)
      : this.api.createEquipement(dto);

    obs$.subscribe({
      next: () => {
        this.equipementSaving = false;
        this.equipementSaved  = true;
        this.showToast(this.editingEquipement ? 'Équipement modifié !' : 'Équipement ajouté !', 'success');
        setTimeout(() => {
          this.equipementSaved     = false;
          this.showEquipementModal = false;
          this.editingEquipement   = null;
          this.loadAll();
        }, 1400);
      },
      error: (err) => {
        this.equipementSaving = false;
        const detail = err?.error?.message ?? err?.message ?? '';
        this.showToast(detail || 'Erreur lors de la sauvegarde.', 'error');
        console.error('[saveEquipement]', err);
      },
    });
  }

  confirmDeleteEquipement(e: Equipement): void { this.equipementToDelete = e; this.showDeleteConfirm = true; }

  deleteEquipement(): void {
    if (!this.equipementToDelete) return;
    this.api.deleteEquipement(this.equipementToDelete.idEquipement).subscribe({
      next:  () => { this.showToast('Équipement supprimé.', 'info'); this.loadAll(); },
      error: () => { this.showToast('Erreur lors de la suppression.', 'error'); },
    });
    this.showDeleteConfirm = false; this.equipementToDelete = null;
  }

  toggleEquipStatut(e: Equipement): void {
    const next = (e.statut||'Actif') === 'Actif' ? 'Inactif' : 'Actif';
    this.api.updateEquipement(e.idEquipement, { ...e, statut: next }).subscribe({
      next:  () => { e.statut = next; this.equipements = [...this.equipements]; this.showToast(`Statut : ${next}`, 'info'); },
      error: () => { this.showToast('Erreur mise à jour statut.', 'error'); },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Alertes
  // ══════════════════════════════════════════════════════════════════════════

  get alertTypes():    string[] { return [...new Set(this.alertes.map(a => a.type))]; }
  get alertesCritiques(): number { return this.alertes.filter(a => !a.traite && a.severite === 'Critique').length; }
  get alertesHautes():    number { return this.alertes.filter(a => !a.traite && a.severite === 'Haute').length; }

  get filteredAlertes(): AlerteExt[] {
    let list = [...this.alertesFiltreesParDate];
    if (this.searchAlerte) { const q = this.searchAlerte.toLowerCase(); list = list.filter(a => a.message.toLowerCase().includes(q) || a.type.toLowerCase().includes(q)); }
    if (this.filterAlertType)     list = list.filter(a => a.type === this.filterAlertType);
    if (this.filterAlertSeverite) list = list.filter(a => a.severite === this.filterAlertSeverite);
    if (this.filterAlertStatut === 'active')  list = list.filter(a => !a.traite);
    if (this.filterAlertStatut === 'traitee') list = list.filter(a => a.traite);
    return list;
  }

  traiterAlerte(a: AlerteExt): void {
    a.traite = true; this.alertes = [...this.alertes];
    this.showToast(`Alerte «\u00a0${a.type}\u00a0» traitée.`, 'success');
  }
  traiterToutesAlertes(): void {
    this.alertes.forEach(a => a.traite = true); this.alertes = [...this.alertes];
    this.showToast('Toutes les alertes ont été traitées.', 'success');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Anomalies
  // ══════════════════════════════════════════════════════════════════════════

  get filteredAnomalies(): AnomalieExt[] {
    let list = [...this.anomalies];
    if (this.searchAnomalie) { const q = this.searchAnomalie.toLowerCase(); list = list.filter(a => a.description.toLowerCase().includes(q)); }
    if (this.filterAnomalieStatus === 'resolu')     list = list.filter(a => a.resolu);
    if (this.filterAnomalieStatus === 'non_resolu') list = list.filter(a => !a.resolu);
    if (this.filterAnomalieType)                    list = list.filter(a => a.type === this.filterAnomalieType);
    return list;
  }

  resolveAnomalie(a: AnomalieExt): void {
    a.resolu = true; this.progressMap.set(a.id, 100); this.anomalies = [...this.anomalies];
    this.showToast('Anomalie marquée comme résolue.', 'success');
  }
  getProgress(a: AnomalieExt): number { return this.progressMap.get(a.id) ?? (a.resolu ? 100 : 0); }

  // ══════════════════════════════════════════════════════════════════════════
  // Recommandations
  // ══════════════════════════════════════════════════════════════════════════

  get priorites(): string[] { return [...new Set(this.recommandations.map(r => r.priorite))]; }

  get filteredRecommandations(): Recommandation[] {
    let list = [...this.recommandations];
    if (this.filterRecoPriorite) list = list.filter(r => r.priorite === this.filterRecoPriorite);
    if (this.filterRecoApplique === 'oui') list = list.filter(r => r.applique);
    if (this.filterRecoApplique === 'non') list = list.filter(r => !r.applique);
    return list;
  }

  appliquerReco(r: Recommandation): void {
    r.applique = !r.applique; this.recommandations = [...this.recommandations];
    this.showToast(r.applique ? 'Recommandation appliquée !' : 'Recommandation annulée.', r.applique ? 'success' : 'info');
  }

  get economiesTotales(): number {
    return this.recommandations.filter(r => r.applique).reduce((s, r) => s + ((r as any).economie ?? 0), 0);
  }

  getRecoPrioriteClass(p: string): string {
    if (p === 'Haute')   return 'tag--danger';
    if (p === 'Moyenne') return 'tag--warn';
    return 'tag--ghost';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rapports
  // ══════════════════════════════════════════════════════════════════════════

  genererRapport(): void { this.exportRapport(); }

  telechargerRapport(type: string): void {
    switch (type) {
      case 'mensuel':     this.exportRapportExcel(); break;
      case 'trimestriel': this.exportRapportTrimestriel(); break;
      case 'seuils':      this.exportRapportSeuils(); break;
      case 'alertes':     this.exportAlertesExcel(); break;
      case 'anomalies':   this.exportRapportAnomalies(); break;
      case 'csv':         this.exportCSV(); break;
    }
  }

  get trimestre(): number { return Math.ceil((new Date().getMonth() + 1) / 3); }

  private exportRapportTrimestriel(): void {
    const lines = [`RAPPORT TRIMESTRIEL — T${this.trimestre} ${new Date().getFullYear()}`, '═'.repeat(60), `Généré le : ${new Date().toLocaleString('fr-FR')}`, `${this.totalMesures} mesures`, '─'.repeat(60), `Alertes : ${this.alertes.length}`, `Anomalies : ${this.anomalies.length}`, `Coût estimé : ${this.coutTotal} DT`];
    this.download(lines.join('\n'), `rapport_trim_T${this.trimestre}.txt`, 'text/plain');
    this.showToast('Rapport trimestriel téléchargé.', 'success');
  }
  private exportRapportSeuils(): void {
    const lines = ['RAPPORT SEUILS', '═'.repeat(60), `Taux de respect : ${this.tauxSeuil}%`, '─'.repeat(60), ...this.seuilsList.map(s => `${s.nom.padEnd(20)}: ${s.valeurActuelle}/${s.valeurCible} ${s.unite} — ${this.getSeuilPct(s)}%`)];
    this.download(lines.join('\n'), `rapport_seuils.txt`, 'text/plain');
    this.showToast('Rapport seuils téléchargé.', 'success');
  }
  private exportRapportAnomalies(): void {
    const headers = ['ID','Type','Description','Date','Énergie','Statut','Progression'];
    const rows = this.anomalies.map(a => [a.id, a.type||'Anomalie', a.description, new Date(a.dateDetection).toLocaleDateString('fr-FR'), a.energieNom||'—', a.resolu?'Résolue':'En cours', `${this.getProgress(a)}%`]);
    this.download('\uFEFF' + [headers,...rows].map(r => r.join(';')).join('\n'), `rapport_anomalies.csv`, 'text/csv');
    this.showToast('Rapport anomalies téléchargé.', 'success');
  }

  exportCSV(): void {
    const headers = ['ID','Valeur','Unité','Source','Énergie','Équipement','Date mesure','Statut'];
    const rows = this.mesures.map(m => [m.idMesure, m.valeur, this.getEnergieUnite(m.energieId), m.sourceDonnee, this.getEnergieNom(m.energieId), m.equipement?.nom||'—', new Date(m.dateMesure).toLocaleString('fr-FR'), this.isAboveThreshold(m.valeur)?'Dépassement':'Normal']);
    this.download('\uFEFF' + [headers,...rows].map(r => r.join(';')).join('\n'), `mesures_wicmic_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    this.showToast('Export CSV téléchargé.', 'success');
  }

  exportRapport(): void {
    const sep = '═'.repeat(60); const sub = '─'.repeat(60);
    const lines = ['WICMIC ENERGY — Rapport de consommation', sep, `Généré le : ${new Date().toLocaleString('fr-FR')}`, `Utilisateur : ${this.currentUser?.nom??'—'}`, `Période : ${this.dateRangeLabel}`, sub, `Total mesures : ${this.mesuresFiltreesParDate.length}`, `Moyenne : ${this.moyenneMesuresFiltrees}`, `Max : ${this.maxMesureFiltre}`, `Min : ${this.minMesureFiltre}`, `Coût période : ${this.coutPeriodeFiltree} DT`, `Coût ce mois : ${this.coutMoisCourant} DT`, `Coût total : ${this.coutTotal} DT`, `Tendance : ${this.tendance} (${this.tendancePct}%)`, sub, `Alertes actives : ${this.alertesNonTraitees} (${this.alertesCritiques} critiques)`, `Anomalies : ${this.anomaliesNonResolues} non résolues / ${this.anomalies.length}`, `Recommandations : ${this.recoAppliquees}/${this.totalRecommandations} appliquées`, sub, '── ÉNERGIES ──', ...this.energies.map(en => `${en.nom.padEnd(20)}: ${this.getEnergieTotal(en.idEnergie)} ${en.unite} — ${this.getEnergieCout(en.idEnergie)} DT (${this.getEnergiePct(en.idEnergie)}%)`), sub];
    this.download(lines.join('\n'), `rapport_wicmic_${new Date().toISOString().slice(0,10)}.txt`, 'text/plain');
    this.showToast('Rapport exporté.', 'success');
  }

  exportRapportPDF(): void {
    const sep = '═'.repeat(72); const sub = '─'.repeat(72);
    const date = new Date().toLocaleString('fr-FR');
    const lines = ['╔'+'═'.repeat(70)+'╗', '║'+'         WICMIC ENERGY — RAPPORT EXÉCUTIF COMPLET'.padEnd(70)+'║', '║'+`         Généré le : ${date}`.padEnd(70)+'║', '║'+`         ${this.totalMesures} mesures · Score efficacité : ${this.efficiencyScore}/100 (${this.efficiencyGrade})`.padEnd(70)+'║', '╚'+'═'.repeat(70)+'╝', '', sep, '  SECTION 1 — TABLEAU DE BORD', sub, `  Score efficacité : ${this.efficiencyScore}/100 (${this.efficiencyGrade})`, `  Coût ce mois : ${this.coutMoisCourant} DT`, `  Coût total : ${this.coutTotal} DT`, `  Tendance : ${this.tendance === 'up' ? '↑ HAUSSE' : this.tendance === 'down' ? '↓ BAISSE' : '→ STABLE'} (${this.tendancePct}%)`, '', sep, '  SECTION 2 — CONSOMMATIONS PAR VECTEUR', sub, ...this.energies.map(en => `  ${en.nom.padEnd(20)}: ${this.getEnergieTotal(en.idEnergie).toString().padStart(8)} ${en.unite.padEnd(6)} | ${this.getEnergieCout(en.idEnergie)} DT | ${this.getEnergiePct(en.idEnergie)}%`), '', sep, '  SECTION 3 — SEUILS', sub, `  Taux de respect : ${this.seuilsDefinis > 0 ? this.tauxSeuil+'%' : 'Aucun seuil défini'}`, ...this.seuilsList.map(s => s.valeurCible === 0 ? `  ${s.nom.padEnd(20)}: Non défini` : `  ${s.nom.padEnd(20)}: ${s.valeurActuelle}/${s.valeurCible} ${s.unite} | ${this.getSeuilPct(s)}% | ${this.getSeuilPct(s) <= 80 ? '✓ OK' : this.getSeuilPct(s) <= 100 ? '⚠ Proche' : '✕ DÉPASSÉ'}`), '', sep, '  SECTION 4 — ALERTES & ANOMALIES', sub, `  Alertes actives : ${this.alertesNonTraitees} (${this.alertesCritiques} critique(s))`, `  Anomalies en cours : ${this.anomaliesNonResolues}/${this.anomalies.length}`, `  Recommandations appliquées : ${this.recoAppliquees}/${this.totalRecommandations}`, '', sep, `  Utilisateur : ${this.currentUser?.nom??'—'}`, sep];
    this.download(lines.join('\n'), `rapport_executif_wicmic_${new Date().toISOString().slice(0,10)}.txt`, 'text/plain');
    this.showToast('Rapport exporté avec succès !', 'success');
  }

  private download(content: string, filename: string, type: string): void {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click(); URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Chat IA
  // ══════════════════════════════════════════════════════════════════════════

  sendChat(): void {
    const msg = this.chatInput.trim();
    if (!msg || this.chatLoading) return;
    this.messages.push({ role: 'user', content: msg, time: new Date() });
    this.chatInput = ''; this.chatLoading = true; this._scrollChat();
    const ctx = [`Contexte WICMIC Energy :`, `- Mesures : ${this.totalMesures} | Moy : ${this.moyenneMesures} | Max : ${this.maxMesure}`, `- Coût mois : ${this.coutMoisCourant} DT | Total : ${this.coutTotal} DT`, `- Alertes actives : ${this.alertesNonTraitees} (${this.alertesCritiques} critiques)`, `- Anomalies : ${this.anomaliesNonResolues}/${this.anomalies.length}`, `- Équipements : ${this.equipementsActifs} actifs / ${this.equipements.length}`, `- Score efficacité : ${this.efficiencyScore}/100 (${this.efficiencyGrade})`, `- Tendance : ${this.tendance} (${this.tendancePct}%)`, `- Période filtrée : ${this.dateRangeLabel}`, `Question : ${msg}`].join('\n');
    this.api.ollamaChat(ctx).subscribe({
      next:  res => { this.messages.push({ role: 'assistant', content: res.response, time: new Date() }); this.chatLoading = false; this._scrollChat(); },
      error: ()  => { this.messages.push({ role: 'assistant', content: 'Service IA indisponible. Assurez-vous qu\'Ollama est démarré.', time: new Date() }); this.chatLoading = false; this._scrollChat(); },
    });
  }
  sendSuggestion(text: string): void { this.chatInput = text; this.sendChat(); }
  onChatEnter(event: Event): void { const ke = event as KeyboardEvent; if (!ke.shiftKey) { event.preventDefault(); this.sendChat(); } }
  private _scrollChat(): void { setTimeout(() => { if (this.chatScrollRef?.nativeElement) this.chatScrollRef.nativeElement.scrollTop = this.chatScrollRef.nativeElement.scrollHeight; }, 50); }

  // ══════════════════════════════════════════════════════════════════════════
  // Mode hors-heure
  // ══════════════════════════════════════════════════════════════════════════

  toggleOffHours(): void {
    this.offHoursMode = !this.offHoursMode;
    this.showToast(this.offHoursMode ? 'Mode hors-heure activé' : 'Mode hors-heure désactivé', 'info');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Benchmarking
  // ══════════════════════════════════════════════════════════════════════════

  private initBenchmarking(): void {
    const now = new Date();
    const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const monthlyTotals: { label: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const fin = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const t = this.mesures.filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; }).reduce((s, m) => s + m.valeur, 0);
      monthlyTotals.push({ label: moisLabels[d.getMonth()], total: +t.toFixed(1) });
    }
    const nonZero = monthlyTotals.filter(m => m.total > 0);
    const maxM = nonZero.length ? Math.max(...nonZero.map(m => m.total)) : 0;
    const minM = nonZero.length ? Math.min(...nonZero.map(m => m.total)) : 0;

    this.benchmarkData = this.energies.map(en => {
      const mesuresEn = this.mesures.filter(m => Number(m.energieId) === Number(en.idEnergie));
      const getM = (offset: number): number => {
        const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const fin = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
        return mesuresEn.filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; }).reduce((s, m) => s + m.valeur, 0);
      };
      const allVals: number[] = [];
      for (let i = 11; i >= 0; i--) { const v = getM(i); if (v > 0) allVals.push(v); }
      const moisActuel = +getM(0).toFixed(1); const moisPrecedent = +getM(1).toFixed(1);
      const moyenne = allVals.length ? +(allVals.reduce((a, b) => a + b, 0) / allVals.length).toFixed(1) : 0;
      const hasData = moisActuel > 0 || moisPrecedent > 0;
      let variation = 0; let position: 'better'|'same'|'worse' = 'same'; let insight = '';
      if (!hasData) { insight = `Aucune donnée pour ${en.nom}.`; }
      else if (moisPrecedent === 0 && moisActuel > 0) { insight = `Premières données ${en.nom} : ${moisActuel} ${en.unite}.`; }
      else if (moisActuel > 0 && moisPrecedent > 0) {
        variation = +((moisActuel - moisPrecedent) / moisPrecedent * 100).toFixed(1);
        if (variation < -3) { position = 'better'; insight = `✓ ${en.nom} en baisse de ${Math.abs(variation)}% vs mois dernier.`; }
        else if (variation > 3) { position = 'worse'; insight = `⚠ ${en.nom} en hausse de ${variation}% vs mois dernier.`; }
        else { insight = `${en.nom} stable (${moisActuel} vs ${moisPrecedent} ${en.unite}).`; }
      } else { insight = `Données partielles pour ${en.nom}.`; }
      return { energie: `${this.getEnergieIcon(Number(en.idEnergie))} ${en.nom}`, unite: en.unite, moisActuel, moisPrecedent, moyenne, variation, position, insight, hasData };
    });

    if (!this.benchmarkData.length) {
      this.benchmarkData = [{ energie: '— Aucune énergie', unite: '', moisActuel: 0, moisPrecedent: 0, moyenne: 0, variation: 0, position: 'same', insight: 'Aucune énergie configurée.', hasData: false }];
    }
    this.rankTimeline = monthlyTotals.map(m => {
      if (m.total === 0) return { label: m.label, pct: 0 };
      let pct = 50;
      if (maxM > minM) { pct = Math.round(100 - ((m.total - minM) / (maxM - minM)) * 100); pct = Math.max(5, Math.min(95, pct)); }
      return { label: m.label, pct };
    });
  }
  get hasRankTimelineData(): boolean { return this.rankTimeline.some(r => r.pct > 0); }

  // ══════════════════════════════════════════════════════════════════════════
  // Prévisions
  // ══════════════════════════════════════════════════════════════════════════

  recalculatePrevisions(): void { this.initPrevisions(); this.showToast('Prévisions recalculées.', 'success'); }

  private initPrevisions(): void {
    const linReg = (pts: {x: number; y: number}[]): {a: number; b: number; r2: number} => {
      const n = pts.length; if (n < 2) return { a: 0, b: pts[0]?.y ?? 0, r2: 0 };
      const sX = pts.reduce((s, p) => s + p.x, 0); const sY = pts.reduce((s, p) => s + p.y, 0);
      const sXY = pts.reduce((s, p) => s + p.x * p.y, 0); const sX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
      const den = n * sX2 - sX * sX; if (den === 0) return { a: 0, b: sY / n, r2: 0 };
      const a = (n * sXY - sX * sY) / den; const b = (sY - a * sX) / n;
      const yM = sY / n; const ssTot = pts.reduce((s, p) => s + Math.pow(p.y - yM, 2), 0);
      const ssRes = pts.reduce((s, p) => s + Math.pow(p.y - (a * p.x + b), 2), 0);
      return { a, b, r2: ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0 };
    };

    const now = new Date();
    const idE = this.idElec;
    const idW = this.idEau;
    const idG = this.idGazoil;

    const getMP = (eid: number) => {
      const pts: {x: number; y: number}[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const fin = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        const t = this.mesures.filter(m => Number(m.energieId) === Number(eid)).filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; }).reduce((s, m) => s + m.valeur, 0);
        if (t > 0) pts.push({ x: 12 - i, y: +t.toFixed(1) });
      }
      return pts;
    };

    const ptE = idE ? getMP(idE) : [];
    const ptW = idW ? getMP(idW) : [];
    const ptG = idG ? getMP(idG) : [];

    const MIN = 3;
    if (ptE.length < MIN && ptW.length < MIN && ptG.length < MIN) {
      this.previsionMoisProchain = { elec: 0, eau: 0, gazoil: 0, fiabilite: 0, elecTrend: 'flat', elecVar: '0', hasEnoughData: false };
      this.previsionRecos = [{ titre: 'Données insuffisantes', description: `Minimum ${MIN} mois requis.`, economie: 0, urgence: 'normale' }];
      this.forecastPoints = []; return;
    }
    const rE = ptE.length >= 2 ? linReg(ptE) : { a: 0, b: 0, r2: 0 };
    const rW = ptW.length >= 2 ? linReg(ptW) : { a: 0, b: 0, r2: 0 };
    const rG = ptG.length >= 2 ? linReg(ptG) : { a: 0, b: 0, r2: 0 };
    const nX = 13;
    const pE = ptE.length >= 2 ? Math.max(0, Math.round(rE.a * nX + rE.b)) : (ptE[0]?.y ?? 0);
    const pW = ptW.length >= 2 ? Math.max(0, Math.round(rW.a * nX + rW.b)) : (ptW[0]?.y ?? 0);
    const pG = ptG.length >= 2 ? Math.max(0, Math.round(rG.a * nX + rG.b)) : (ptG[0]?.y ?? 0);
    const cE = ptE.length ? ptE[ptE.length-1].y : 0;
    const varE = cE > 0 ? +Math.abs(((pE - cE)/cE)*100).toFixed(1) : 0;
    const tot = ptE.length + ptW.length + ptG.length;
    const fid = tot >= 3 ? Math.round(((rE.r2*ptE.length + rW.r2*ptW.length + rG.r2*ptG.length) / Math.max(1,tot)) * 100) : 0;
    this.previsionMoisProchain = { elec: pE, eau: pW, gazoil: pG, fiabilite: Math.max(5, Math.min(99, fid)), elecTrend: pE > cE*1.03 ? 'up' : pE < cE*0.97 ? 'down' : 'flat', elecVar: String(varE), hasEnoughData: true };
    this.previsionRecos = [];

    const nomElec   = this.getEnergieNom(idE);
    const nomGazoil = this.getEnergieNom(idG);

    if (ptE.length >= 2 && rE.a > 0)  this.previsionRecos.push({ titre: `Tendance ${nomElec} en hausse`, description: `+${rE.a.toFixed(1)} ${this.getEnergieUnite(idE)}/mois sur ${ptE.length} mois. Fiabilité : ${Math.round(rE.r2*100)}%.`, economie: Math.max(0, Math.round(rE.a * this.getTarifById(idE) * 12)), urgence: rE.a > 50 ? 'haute' : 'normale' });
    else if (ptE.length >= 2 && rE.a < 0) this.previsionRecos.push({ titre: `Bonne tendance ${nomElec}`, description: `Réduction de ${Math.abs(rE.a).toFixed(1)} ${this.getEnergieUnite(idE)}/mois sur ${ptE.length} mois.`, economie: Math.round(Math.abs(rE.a) * this.getTarifById(idE) * 3), urgence: 'normale' });
    if (ptG.length >= 2 && rG.a > 0) this.previsionRecos.push({ titre: `Hausse du ${nomGazoil}`, description: `+${rG.a.toFixed(1)} ${this.getEnergieUnite(idG)}/mois sur ${ptG.length} mois.`, economie: Math.round(rG.a * this.getTarifById(idG) * 3), urgence: 'haute' });
    if (!this.previsionRecos.length) this.previsionRecos.push({ titre: 'Consommations stables', description: `Stables sur ${Math.max(ptE.length,ptW.length,ptG.length)} mois. Fiabilité : ${fid}%.`, economie: 0, urgence: 'normale' });
    this.buildForecastPoints();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Heatmap
  // ══════════════════════════════════════════════════════════════════════════

  onHeatmapEnergieChange(): void { this.initHeatmap(); }

  get heatmapHoursWithData(): number {
    const debut = new Date(Date.now() - 7*86400000);
    return this.mesures.filter(m => Number(m.energieId) === Number(this.heatmapEnergie) && new Date(m.dateMesure) >= debut).length;
  }
  get heatmapHasDayData(): boolean { return this.heatmapData.some(row => row.some(v => v > 0)); }

  get heatmapPeakPct(): number {
    if (!this.heatmapData.length) return 0;
    const peak = [8,9,10,11,14,15,16,17]; const off = [22,23,0,1,2,3,4,5];
    const pV = this.heatmapData.flatMap(r => peak.map(h => r[h])).filter(v => v > 0);
    const oV = this.heatmapData.flatMap(r => off.map(h => r[h])).filter(v => v > 0);
    if (!pV.length || !oV.length) return 0;
    const pA = pV.reduce((s,v)=>s+v,0)/pV.length; const oA = oV.reduce((s,v)=>s+v,0)/oV.length;
    return oA > 0 ? Math.round(((pA-oA)/oA)*100) : 0;
  }
  get heatmapEconomy(): number {
    if (!this.heatmapData.length) return 0;
    const t = this.heatmapData.reduce((s,r)=>s+r.reduce((rs,v)=>rs+v,0),0);
    return t ? +(t*0.2*this.tarifKwh*4).toFixed(0) : 0;
  }
  getHeatColor(val: number): string {
    if (!val) return 'rgba(0,0,0,0.04)';
    const all = this.heatmapData.flat().filter(v => v > 0);
    if (!all.length) return 'rgba(0,0,0,0.04)';
    const r = Math.min(1, val / Math.max(...all));
    if (r < 0.25) return `rgba(99,102,241,${0.15 + r * 0.9})`;
    if (r < 0.5)  return `rgba(20,184,166,${0.3 + r * 0.7})`;
    if (r < 0.75) return `rgba(245,158,11,${0.4 + r * 0.6})`;
    return `rgba(239,68,68,${0.5 + r * 0.5})`;
  }

  private initHeatmap(): void {
    const days = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']; const now = new Date();
    this.heatmapDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now); d.setDate(d.getDate() - 6 + i);
      return days[d.getDay() === 0 ? 6 : d.getDay() - 1] + ' ' + d.getDate();
    });
    this.heatmapHourLabels = Array.from({ length: 24 }, (_, i) => i % 4 === 0 ? (i<10?'0'+i:''+i)+'h' : '');
    const eid = +this.heatmapEnergie;
    const mf = this.mesures.filter(m => Number(m.energieId) === Number(eid));
    this.heatmapData = Array.from({ length: 7 }, (_, di) => {
      const d = new Date(now); d.setDate(d.getDate() - 6 + di);
      const ds = d.toDateString();
      return Array.from({ length: 24 }, (_, hi) => {
        const mh = mf.filter(m => { const dm = new Date(m.dateMesure); return dm.toDateString() === ds && dm.getHours() === hi; });
        return mh.length ? +(mh.reduce((s,m)=>s+m.valeur,0)/mh.length).toFixed(1) : 0;
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Toast
  // ══════════════════════════════════════════════════════════════════════════

  showToast(msg: string, type: 'success'|'error'|'info'|'warn'): void {
    const id = ++this.toastCounter;
    this.toasts.unshift({ id, msg, type });
    setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 4200);
  }
  dismissToast(id: number): void { this.toasts = this.toasts.filter(t => t.id !== id); }

  // ══════════════════════════════════════════════════════════════════════════
  // Load All
  // ══════════════════════════════════════════════════════════════════════════

  loadAll(): void {
    this.loading = true; this.apiErrors = {};
    let done = 0; const total = 7;
    const check = () => {
      if (++done < total) return;
      this.loading = false;
      if (!this.heatmapEnergie && this.energies.length > 0) {
        this.heatmapEnergie = String(this.energies[0].idEnergie);
      }
      this.initSeuilsFromEnergies();
      this.syncSeuilsActuelles();
      this.initBenchmarking();
      this.initPrevisions();
      this.initHeatmap();
      this.buildForecastPoints();
      this.buildSparklines();
    };

    this.api.getMesures().subscribe({
      next: (d: unknown[]) => { this.mesures = d.map(m => this.normalizeMesure(m)); check(); },
      error: () => { this.apiErrors['mesures'] = true; check(); },
    });
    this.api.getAlertes().subscribe({
      next: (d: unknown[]) => { this.alertes = d.map(a => this.normalizeAlerte(a)); check(); },
      error: () => { this.apiErrors['alertes'] = true; check(); },
    });
    this.api.getAnomalies().subscribe({
      next: (d: unknown[]) => {
        this.anomalies = d.map(a => this.normalizeAnomalie(a));
        this.anomalies.forEach(a => { if (!this.progressMap.has(a.id)) this.progressMap.set(a.id, a.resolu ? 100 : 0); });
        check();
      },
      error: () => { this.apiErrors['anomalies'] = true; check(); },
    });
    this.api.getRecommandations().subscribe({
      next: (d: Recommandation[]) => { this.recommandations = d; check(); },
      error: () => { this.apiErrors['recommandations'] = true; check(); },
    });
    this.api.getEquipements().subscribe({
      next: (d: unknown[]) => { this.equipements = d.map(e => this.normalizeEquipement(e)); check(); },
      error: () => { this.apiErrors['equipements'] = true; check(); },
    });
    this.api.getEnergies().subscribe({
      next: (d: unknown[]) => { this.energies = d.map(e => this.normalizeEnergie(e)); check(); },
      error: () => { this.apiErrors['energies'] = true; check(); },
    });
    this.api.getZones().subscribe({
      next: (d: Zone[]) => { this.zones = d; check(); },
      error: () => { this.apiErrors['zones'] = true; check(); },
    });
  }

  get hasApiErrors(): boolean { return Object.keys(this.apiErrors).length > 0; }
  get apiErrorsList(): string[] { return Object.keys(this.apiErrors); }

  logout(): void { this.auth.logout(); }
}