import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  ReactiveFormsModule, FormsModule,
  FormBuilder, FormGroup, Validators
} from '@angular/forms';

import { ApiService }  from 'src/app/core/api/api.service';
import { AuthService } from 'src/app/core/auth/auth.service';
import {
  Mesure, Alerte, Anomalie, Recommandation,
  Equipement, Energie, Zone, OllamaMessage
} from 'src/app/core/api/api.models';

interface ToastMsg   { id: number; msg: string; type: 'success'|'error'|'info'|'warn'; }
interface ChartPoint { label: string; value: number; x: number; y: number; width?: number; height?: number; }

interface Seuil {
  id: number;
  energieId: number;
  nom: string;
  periode: string;
  annee: number;
  valeurCible: number;
  valeurActuelle: number;
  unite: string;
  /** Alias de valeurCible — utilisé par le template HTML gaz */
  valeur: number;
}

interface BenchmarkItem {
  energie: string;
  unite: string;
  moisActuel: number;
  moisPrecedent: number;
  moyenne: number;
  variation: number;
  position: 'better' | 'same' | 'worse';
  insight: string;
  hasData: boolean;
}

interface AlerteExt {
  idAlerte:      number;
  type:          string;
  message:       string;
  seuil:         number;
  severite:      string;
  traite:        boolean;
  dateCreation:  string;
  equipementId?: number | null;
  sourceAuto?:   boolean;
  [key: string]: any;
}

interface AnomalieExt {
  id:            number;
  idAnomalie?:   number;
  description:   string;
  dateDetection: string;
  resolu:        boolean;
  type?:         string;
  energieNom?:   string;
  energieId?:    number | null;
  valeur?:       number;
  severite?:     string;
  [key: string]: any;
}

interface AnomalieLocale {
  description: string;
  valeur: number;
  date: string;
  resolu: boolean;
}

interface StatPeriode {
  label:     string;
  total:     number;
  nbMesures: number;
  cout:      number;
}

interface RecommandationExt extends Recommandation {
  economieEstimee?: number | null;
}

@Component({
  selector: 'wic-gas-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule],
  templateUrl: './gas-dashboard.component.html',
  styleUrls:   ['./gas-dashboard.component.css'],
})
export class GasDashboardComponent implements OnInit, OnDestroy {

  @ViewChild('chatScrollRef') private chatScrollRef!: ElementRef;

  // ── State général ─────────────────────────────────────────────────────────
  activeTab    = 'mesures';
  currentUser  = this.auth.getCurrentUser();
  currentTime  = new Date();
  loading      = true;
  navCollapsed = false;
  private clockInterval: any;
  private toastCounter = 0;

  // ── Données API ───────────────────────────────────────────────────────────
  mesures:         Mesure[]            = [];
  alertes:         AlerteExt[]         = [];
  anomalies:       AnomalieExt[]       = [];
  recommandations: RecommandationExt[] = [];
  equipements:     Equipement[]        = [];
  energies:        Energie[]           = [];
  zones:           Zone[]              = [];

  toasts:    ToastMsg[]               = [];
  apiErrors: Record<string, boolean>  = {};

  // ── Erreur API ────────────────────────────────────────────────────────────
  get hasApiError(): boolean { return Object.keys(this.apiErrors).length > 0; }

  // ── Énergie gaz ───────────────────────────────────────────────────────────
  readonly gazId = 2;

  get energieLabel(): string { return this.getEnergieNom(this.gazId) || 'Gaz'; }
  get energieUnite(): string { return this.getEnergieUnite(this.gazId) || 'm³'; }

  /**
   * Retourne le nom EXACT de l'énergie tel qu'il est en BDD.
   * On l'envoie directement sans transformation : le backend fait .ToLower()
   * des deux côtés, donc peu importe la casse ou les accents.
   * Si les énergies ne sont pas encore chargées, retourne '' pour bloquer l'envoi.
   */
  get energieNomApi(): string {
    // Priorité 1 : nom exact venant de l'API /energies
    const fromEnergies = this.energies.find(e => Number(e.idEnergie) === this.gazId);
    if (fromEnergies?.nom) return fromEnergies.nom;

    // Priorité 2 : nom venant des mesures déjà chargées
    for (const m of this.mesures) {
      if (Number(m.energieId) === this.gazId && m.energie?.nom)
        return m.energie.nom;
    }

    return '';
  }

  // ── Modal Mesure ──────────────────────────────────────────────────────────
  showMesureModal         = false;
  mesureForm!:            FormGroup;
  mesureSaving            = false;
  mesureSaved             = false;
  editingMesure:          Mesure | null = null;
  mesureToDelete:         Mesure | null = null;
  deleteSaving            = false;
  showDeleteMesureConfirm = false;

  // ── Modal Équipement ──────────────────────────────────────────────────────
  showEquipementModal          = false;
  equipementForm!:             FormGroup;
  equipementSaving             = false;
  equipementSaved              = false;
  editingEquipement:           Equipement | null = null;
  showDeleteEquipementConfirm  = false;
  equipementToDelete:          Equipement | null = null;

  // Rétro-compatibilité si le HTML utilise encore showDeleteConfirm
  get showDeleteConfirm(): boolean {
    return this.showDeleteMesureConfirm || this.showDeleteEquipementConfirm;
  }
  set showDeleteConfirm(_: boolean) {}

  // ── Modal Seuil ───────────────────────────────────────────────────────────
  showSeuilModal         = false;
  seuilForm!:            FormGroup;
  seuilSaving            = false;
  seuilSaved             = false;
  editingSeuil:          Seuil | null = null;
  seuilsList:            Seuil[]      = [];
  seuilsHistorique:      Seuil[]      = [];
  showDeleteSeuilConfirm = false;
  seuilToDelete:         Seuil | null = null;
  deleteSeuilSaving      = false;
  seuilAlerte            = 0;

  // ── Modal Alerte ──────────────────────────────────────────────────────────
  showAlerteModal         = false;
  alerteForm!:            FormGroup;
  alerteSaving            = false;
  alerteSaved             = false;
  alertesAutoGenerees     = 0;
  editingAlerte:          AlerteExt | null = null;
  alerteToDelete:         AlerteExt | null = null;
  showDeleteAlerteConfirm = false;
  alertesApi:             AlerteExt[] = [];

  // ── Modal Anomalie ────────────────────────────────────────────────────────
  showAnomalieModal = false;
  anomalieForm!:    FormGroup;
  anomalieSaving    = false;
  anomalieSaved     = false;

  private _anomaliesLocalesResoluIds = new Set<string>();

  get anomaliesLocales(): AnomalieLocale[] {
    if (!this.seuilAlerte) return [];
    return this.mesures
      .filter(m => m.valeur > this.seuilAlerte)
      .map(m => ({
        description: `Consommation de ${m.valeur} m³ dépasse le seuil de ${this.seuilAlerte} m³`,
        valeur:  m.valeur,
        date:    m.dateMesure,
        resolu:  this._anomaliesLocalesResoluIds.has(m.dateMesure + '_' + m.valeur),
      }));
  }

  get anomaliesApi(): AnomalieExt[] { return this.anomalies; }

  resolveAnomalieLocale(a: AnomalieLocale): void {
    this._anomaliesLocalesResoluIds.add(a.date + '_' + a.valeur);
    this.showToast('Anomalie résolue.', 'success');
  }

  // ── Filtres Alertes ───────────────────────────────────────────────────────
  searchAlerte         = '';
  filterAlertType      = '';
  filterAlertSeverite  = '';
  filterAlertStatut    = '';
  filterAlerteSeverite = '';
  filterAlerteTraite   = '';

  // ── Filtres Anomalies ─────────────────────────────────────────────────────
  searchAnomalie       = '';
  filterAnomalieStatus = '';
  filterAnomalieType   = '';
  private progressMap  = new Map<number, number>();

  // ── Filtres Recommandations ───────────────────────────────────────────────
  filterRecoPriorite = '';
  filterRecoApplique = '';

  // ── Filtres Mesures ───────────────────────────────────────────────────────
  searchMesure  = '';
  filterSource  = '';
  filterEquip   = '';
  sortBy        = 'date_desc';
  mesurePage    = 1;
  mesurePerPage = 10;

  // ── Chart ─────────────────────────────────────────────────────────────────
  chartPeriod:   '7j'|'30j'|'90j' = '7j';
  chartType:     'ligne'|'barres'  = 'ligne';
  alertThreshold = 200;
  readonly CHART_W     = 800;
  readonly CHART_H     = 160;
  readonly CHART_PAD_X = 42;
  readonly CHART_PAD_Y = 16;
  hoveredPoint:   ChartPoint | null = null;
  hoveredPointN1: ChartPoint | null = null;
  showComparaison = false;

  tarifM3  = 0.45;
  tarifGaz = 0.45;

  // ── IA ────────────────────────────────────────────────────────────────────
  showChat    = false;
  messages:   OllamaMessage[] = [];
  chatInput   = '';
  chatLoading = false;

  showIaChat    = false;
  iaChat        = '';
  iaChatLoading = false;
  iaChatInput   = '';
  iaLoading     = false;
  iaAnalyse     = '';

  min = Math.min;

  // ── Heatmap ───────────────────────────────────────────────────────────────
  offHoursMode    = false;
  heatmapEnergie  = '2';
  heatmapHovered: { day: number; hour: number; val: number } | null = null;
  heatmapData:       number[][] = [];
  heatmapDays:       string[]   = [];
  heatmapHourLabels: string[]   = [];

  // ── Benchmarking ──────────────────────────────────────────────────────────
  benchmarkData: BenchmarkItem[]                  = [];
  rankTimeline:  { label: string; pct: number }[] = [];

  // ── Prévisions ────────────────────────────────────────────────────────────
  previsionMoisProchain = {
    elec: 0, eau: 0, gazoil: 0, fiabilite: 0,
    elecTrend: 'flat' as 'up'|'down'|'flat',
    elecVar: '0', hasEnoughData: false,
  };
  previsionRecos: { titre: string; description: string; economie: number; urgence: string }[] = [];
  forecastPoints: ChartPoint[] = [];

  // ── Comparaison de périodes ───────────────────────────────────────────────
  comparePeriode:        'mois'|'trimestre'|'annee' = 'mois';
  statPeriodeCourante:   StatPeriode | null = null;
  statPeriodePrecedente: StatPeriode | null = null;
  variationConsommation  = 0;

  // ── Filtres Équipements ───────────────────────────────────────────────────
  searchEquip       = '';
  filterEquipType   = '';
  filterEquipStatut = '';
  equipPage         = 1;
  equipPerPage      = 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS PUBLICS
  // ═══════════════════════════════════════════════════════════════════════════

  get canWrite(): boolean { return this.canEdit; }

  get canEdit(): boolean {
    // 1) Rôle via AuthService (currentUser)
    const roleService = (this.currentUser?.role ?? '').toLowerCase();
    // 2) Rôle lu directement depuis le JWT (fallback si AuthService ne mappe pas tous les claims)
    const roleJwt = this._getRoleFromJwt().toLowerCase();
    const role = roleService || roleJwt;
    const allowed = ['responsable_energie', 'administrateur', 'responsable_gaz',
                     'responsable energie', 'admin', 'superadmin'];
    return allowed.some(r => role.includes(r));
  }

  get seuils(): Seuil[] { return this.seuilsList; }

  get anomaliesCount(): number {
    return this.anomaliesLocales.filter(a => !a.resolu).length
         + this.anomalies.filter(a => !a.resolu).length;
  }

  get alertesActives(): number { return this.alertes.filter(a => !a.traite).length; }

  get notifNonLues(): number { return this.alertesActives + this.anomaliesCount; }

  get tendanceLabel(): string {
    switch (this.tendance) {
      case 'up':   return '↑ En hausse';
      case 'down': return '↓ En baisse';
      default:     return '→ Stable';
    }
  }

  get recommandationsEnCours(): RecommandationExt[] {
    return this.recommandations.filter(r => !r.applique);
  }
  get recommandationsAppliques(): RecommandationExt[] {
    return this.recommandations.filter(r => r.applique);
  }

  get mesuresMoisCourant(): number {
    const now = new Date();
    return this.mesures.filter(m => {
      const d = new Date(m.dateMesure);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }

  get consommationMoisCourant(): number {
    const now = new Date();
    return +this.mesures
      .filter(m => {
        const d = new Date(m.dateMesure);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, m) => s + m.valeur, 0)
      .toFixed(1);
  }

  get mesureTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMesures.length / this.mesurePerPage));
  }
  get mesurePages(): number[] {
    return Array.from({ length: this.mesureTotalPages }, (_, i) => i + 1);
  }
  get pagedMesures(): Mesure[] {
    const start = (this.mesurePage - 1) * this.mesurePerPage;
    return this.filteredMesures.slice(start, start + this.mesurePerPage);
  }

  get filteredMesures(): Mesure[] {
    let list = [...this.mesures];
    const q = this.searchMesure.trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        m.sourceDonnee.toLowerCase().includes(q) ||
        String(m.valeur).includes(q) ||
        (m.commentaire ?? '').toLowerCase().includes(q)
      );
    }
    if (this.filterSource) list = list.filter(m => m.sourceDonnee === this.filterSource);
    if (this.filterEquip)  list = list.filter(m => String(m.equipementId) === String(this.filterEquip));
    list.sort((a, b) => {
      switch (this.sortBy) {
        case 'date_asc': return new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime();
        case 'val_desc': return b.valeur - a.valeur;
        case 'val_asc':  return a.valeur - b.valeur;
        default:         return new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime();
      }
    });
    return list;
  }

  get filteredAlertes(): AlerteExt[] {
    let list = [...this.alertes];
    const sev   = this.filterAlerteSeverite || this.filterAlertSeverite;
    const trait = this.filterAlerteTraite   || this.filterAlertStatut;
    if (this.searchAlerte) {
      const q = this.searchAlerte.toLowerCase();
      list = list.filter(a => a.message.toLowerCase().includes(q) || a.type.toLowerCase().includes(q));
    }
    if (this.filterAlertType) list = list.filter(a => a.type === this.filterAlertType);
    if (sev)   list = list.filter(a => a.severite === sev);
    if (trait === 'non' || trait === 'active')  list = list.filter(a => !a.traite);
    if (trait === 'oui' || trait === 'traitee') list = list.filter(a =>  a.traite);
    return list;
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  get totalConsommation(): number {
    return +this.mesures.reduce((s, m) => s + m.valeur, 0).toFixed(1);
  }
  get economiePotentielle(): number {
    if (!this.seuilAlerte || this.totalConsommation <= this.seuilAlerte) return 0;
    return +((this.totalConsommation - this.seuilAlerte) * this.tarifGaz).toFixed(2);
  }
  get totalMesures()         { return this.mesures.length; }
  get alertesNonTraitees()   { return this.alertes.filter(a => !a.traite).length; }
  get anomaliesNonResolues() { return this.anomalies.filter(a => !a.resolu).length; }
  get totalRecommandations() { return this.recommandations.length; }
  get recoAppliquees()       { return this.recommandations.filter(r => r.applique).length; }
  get alertesCritiques()     { return this.alertes.filter(a => !a.traite && a.severite === 'Critique').length; }
  get alertesHautes()        { return this.alertes.filter(a => !a.traite && a.severite === 'Haute').length; }

  get moyenneMesures(): number {
    if (!this.mesures.length) return 0;
    return +(this.mesures.reduce((s, m) => s + m.valeur, 0) / this.mesures.length).toFixed(1);
  }
  get maxMesure(): number { return this.mesures.length ? +Math.max(...this.mesures.map(m => m.valeur)).toFixed(1) : 0; }
  get minMesure(): number { return this.mesures.length ? +Math.min(...this.mesures.map(m => m.valeur)).toFixed(1) : 0; }

  get coutTotal(): number {
    return +(this.mesures.reduce((s, m) => s + m.valeur, 0) * this.tarifGaz).toFixed(2);
  }
  get coutMoisCourant(): number {
    const now = new Date();
    return +this.mesures
      .filter(m => {
        const d = new Date(m.dateMesure);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, m) => s + m.valeur * this.tarifGaz, 0)
      .toFixed(2);
  }
  get mesuresAujourd(): number {
    const today = new Date().toDateString();
    return this.mesures.filter(m => new Date(m.dateMesure).toDateString() === today).length;
  }
  get mesuresSemaine(): number {
    const debut = new Date(); debut.setDate(debut.getDate() - 7);
    return this.mesures.filter(m => new Date(m.dateMesure) >= debut).length;
  }

  get tendance(): 'up'|'down'|'stable' {
    if (this.mesures.length < 2) return 'stable';
    const sorted = [...this.mesures].sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    const last = sorted[sorted.length - 1].valeur;
    const prev = sorted[sorted.length - 2].valeur;
    if (last > prev * 1.05) return 'up';
    if (last < prev * 0.95) return 'down';
    return 'stable';
  }
  get tendancePct(): string {
    if (this.mesures.length < 2) return '0';
    const sorted = [...this.mesures].sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    const last = sorted[sorted.length - 1].valeur;
    const prev = sorted[sorted.length - 2].valeur;
    if (!prev) return '0';
    return Math.abs(((last - prev) / prev) * 100).toFixed(1);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  trackByToastId(_: number, item: ToastMsg): number { return item.id; }
  onFilterChange(): void { this.mesurePage = 1; }
  recalcCout(): void { this.tarifM3 = this.tarifGaz; }

  getEquipNom(id: number | null | undefined): string {
    if (!id) return '—';
    const e = this.equipements.find(eq => Number(eq.idEquipement) === Number(id));
    return e?.nom ?? '—';
  }

  getSeveriteClass(s?: string): string {
    if (s === 'Critique') return 'tag--danger';
    if (s === 'Haute')    return 'tag--warn';
    return 'tag--ghost';
  }
  getPrioriteClass(p?: string): string {
    if (p === 'Haute')   return 'tag--danger';
    if (p === 'Moyenne') return 'tag--warn';
    return 'tag--ghost';
  }
  getRecoPrioriteClass(p?: string): string { return this.getPrioriteClass(p); }
  isAboveThreshold(val: number): boolean { return val > this.alertThreshold; }

  get nowIso(): string     { return new Date().toISOString().slice(0, 16); }
  get todayDate(): string  { return new Date().toISOString().slice(0, 10); }
  get currentYear(): number { return new Date().getFullYear(); }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR / LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(
    private api:  ApiService,
    private auth: AuthService,
    private fb:   FormBuilder,
  ) {}

  ngOnInit(): void {
    this.initForms();
    this.loadAll();
    this.clockInterval = setInterval(() => this.currentTime = new Date(), 1000);
    this.messages = [{
      role: 'assistant',
      content: 'Bonjour ! Je suis votre assistant IA Wicmic Gaz. Comment puis-je vous aider ?',
      time: new Date(),
    }];
  }

  ngOnDestroy(): void { clearInterval(this.clockInterval); }

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMS
  // ═══════════════════════════════════════════════════════════════════════════

  private initForms(): void {
    this.mesureForm = this.fb.group({
      valeur:       ['', [Validators.required, Validators.min(0)]],
      dateMesure:   [new Date().toISOString().slice(0, 16), Validators.required],
      sourceDonnee: ['Saisie manuelle', Validators.required],
      equipementId: [null],
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
      periode:     ['Mensuel', Validators.required],
      annee:       [new Date().getFullYear(), [Validators.required, Validators.min(2020), Validators.max(2035)]],
      valeurCible: ['', [Validators.required, Validators.min(1)]],
    });
    this.alerteForm = this.fb.group({
      type:         ['Consommation élevée', Validators.required],
      severite:     ['Normale', Validators.required],
      message:      ['', Validators.required],
      seuil:        [0, [Validators.required, Validators.min(0)]],
      equipementId: [''],
    });
    this.anomalieForm = this.fb.group({
      type:          ['Pic de consommation', Validators.required],
      description:   ['', Validators.required],
      dateDetection: [new Date().toISOString().slice(0, 10), Validators.required],
      equipementId:  [''],
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALISATION
  // ═══════════════════════════════════════════════════════════════════════════

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
    const energieId    = m.energieId  ?? m.EnergieId  ?? energieRaw?.idEnergie ?? energieRaw?.IdEnergie ?? this.gazId;
    const equipementId = m.equipementId ?? m.EquipementId ?? equipRaw?.idEquipement ?? equipRaw?.IdEquipement ?? null;
    return {
      idMesure:     m.idMesure     ?? m.IdMesure    ?? 0,
      valeur:       +(m.valeur     ?? m.Valeur       ?? 0),
      dateMesure:   m.dateMesure   ?? m.DateMesure   ?? new Date().toISOString(),
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
      idEquipement:      e.idEquipement      ?? e.IdEquipement      ?? 0,
      nom:               e.nom               ?? e.Nom               ?? '',
      typeEquipement:    e.typeEquipement    ?? e.TypeEquipement    ?? '',
      statut:            e.statut            ?? e.Statut            ?? 'Actif',
      puissance:         +(e.puissance       ?? e.Puissance         ?? 0),
      localisation:      e.localisation      ?? e.Localisation      ?? '',
      dateMiseEnService: e.dateMiseEnService  ?? e.DateMiseEnService ?? null,
      dateInstallation:  e.dateInstallation   ?? e.DateInstallation  ?? null,
      energieId,
      zoneId:            e.zoneId            ?? e.ZoneId            ?? null,
      energie:           energieRaw ? this.normalizeEnergie(energieRaw) : null,
      zone:              e.zone              ?? e.Zone              ?? null,
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
      equipementId: a.equipementId ?? a.EquipementId ?? null,
      sourceAuto:   a.sourceAuto   ?? a.SourceAuto   ?? false,
    };
  }

  private normalizeAnomalie(a: any): AnomalieExt {
    return {
      id:            a.id            ?? a.idAnomalie ?? a.IdAnomalie ?? 0,
      idAnomalie:    a.idAnomalie    ?? a.IdAnomalie ?? 0,
      description:   a.description   ?? a.Description   ?? '',
      dateDetection: a.dateDetection ?? a.DateDetection ?? new Date().toISOString(),
      resolu:        a.resolu        ?? a.Resolu        ?? false,
      type:          a.type          ?? a.Type          ?? 'Anomalie',
      energieNom:    a.energieNom    ?? '',
      energieId:     a.energieId     ?? null,
      valeur:        +(a.valeur      ?? 0),
      severite:      a.severite      ?? 'Normale',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEUILS
  // ═══════════════════════════════════════════════════════════════════════════

  private syncSeuilsActuelles(): void {
    this.seuilsList = this.seuilsList.map(s => ({
      ...s, valeurActuelle: this.getEnergieTotal(s.energieId),
    }));
    this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
    this.updateSeuilAlerte();
  }

  private updateSeuilAlerte(): void {
    const gaz = this.seuilsList.find(s => s.energieId === this.gazId && s.periode === 'Mensuel');
    this.seuilAlerte = gaz?.valeurCible ?? 0;
  }

  private initSeuilsFromEnergies(): void {
    if (!this.energies.length) return;
    this.api.getSeuils().subscribe({
      next: (data: any[]) => {
        this.seuilsList = this.energies.map((e, i) => {
          const found = data.find(s => (s.energieId ?? s.EnergieId) === Number(e.idEnergie));
          const _vc1 = found?.valeur ?? 0;
          return {
            id:             found ? (found.idSeuil ?? found.IdSeuil ?? i + 1) : i + 1,
            energieId:      Number(e.idEnergie),
            nom:            e.nom,
            periode:        found?.periode  ?? 'Mensuel',
            annee:          found?.annee    ?? new Date().getFullYear(),
            valeurCible:    _vc1,
            valeur:         _vc1,
            valeurActuelle: this.getEnergieTotal(Number(e.idEnergie)),
            unite:          e.unite,
          };
        });
        this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
        this.updateSeuilAlerte();
      },
      error: () => {
        if (!this.seuilsList.length) {
          this.seuilsList = this.energies.map((e, i) => ({
            id: i + 1, energieId: Number(e.idEnergie), nom: e.nom,
            periode: 'Mensuel', annee: new Date().getFullYear(),
            valeurCible: 0, valeur: 0,
            valeurActuelle: this.getEnergieTotal(Number(e.idEnergie)), unite: e.unite,
          }));
        }
        this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
        this.updateSeuilAlerte();
      },
    });
  }

  openAddSeuilModal(): void { this.openSeuilModal(); }
  openEditSeuil(s: Seuil): void { this.openSeuilModal(s); }

  openSeuilModal(seuil?: Seuil): void {
    this.editingSeuil = seuil ?? null;
    this.seuilSaved   = false;
    if (seuil) {
      this.seuilForm.patchValue({ periode: seuil.periode, valeurCible: seuil.valeurCible, annee: seuil.annee });
    } else {
      this.seuilForm.reset({ periode: 'Mensuel', annee: new Date().getFullYear() });
    }
    this.showSeuilModal = true;
  }

  confirmDeleteSeuil(s: Seuil): void {
    this.seuilToDelete          = s;
    this.showDeleteSeuilConfirm = true;
  }

  deleteSeuil(): void {
    const target = this.seuilToDelete;
    if (!target) return;
    this.deleteSeuilSaving = true;
    this.api.deleteSeuilByEnergie(target.energieId).subscribe({
      next: () => {
        const idx = this.seuilsList.findIndex(x => x.id === target.id);
        if (idx >= 0) this.seuilsList[idx] = { ...this.seuilsList[idx], valeurCible: 0, valeur: 0 };
        this.seuilsList             = [...this.seuilsList];
        this.seuilsHistorique       = this.seuilsList.filter(x => x.valeurCible > 0);
        this.deleteSeuilSaving      = false;
        this.showDeleteSeuilConfirm = false;
        this.seuilToDelete          = null;
        this.updateSeuilAlerte();
        this.showToast('Seuil supprimé.', 'info');
      },
      error: () => { this.deleteSeuilSaving = false; this.showToast('Erreur lors de la suppression.', 'error'); },
    });
  }

  getSeuilPct(s: Seuil): number {
    if (!s.valeurCible) return 0;
    return Math.round((s.valeurActuelle / s.valeurCible) * 100);
  }

  saveSeuil(): void {
    if (this.seuilForm.invalid) { this.seuilForm.markAllAsTouched(); return; }
    this.seuilSaving = true;
    const v         = this.seuilForm.value;
    const energieId = this.gazId;
    const payload   = { energieId, valeur: +v.valeurCible, periode: v.periode, annee: +v.annee };
    const isEdit    = !!this.editingSeuil && this.editingSeuil.valeurCible > 0;
    const req$      = isEdit ? this.api.updateSeuil(energieId, payload) : this.api.createSeuil(payload);

    req$.subscribe({
      next: () => {
        const idx     = this.seuilsList.findIndex(s => s.energieId === energieId);
        const _vc4 = +v.valeurCible;
        const updated: Seuil = {
          id:             this.editingSeuil?.id ?? Date.now(),
          energieId,      nom: this.getEnergieNom(energieId),
          periode:        v.periode,   annee:          +v.annee,
          valeurCible:    _vc4,
          valeur:         _vc4,
          valeurActuelle: this.getEnergieTotal(energieId),
          unite:          this.getEnergieUnite(energieId),
        };
        if (idx >= 0) this.seuilsList[idx] = updated;
        else          this.seuilsList       = [...this.seuilsList, updated];
        this.seuilsList       = [...this.seuilsList];
        this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
        this.seuilSaving = false; this.seuilSaved = true; this.editingSeuil = null;
        this.updateSeuilAlerte();
        this.showToast('Seuil enregistré !', 'success');
        setTimeout(() => { this.seuilSaved = false; this.showSeuilModal = false; }, 1600);
      },
      error: (err: any) => {
        if (err.status === 400 && !isEdit) {
          this.api.updateSeuil(energieId, payload).subscribe({
            next:  () => { this.seuilSaving = false; this.seuilSaved = true; this.showToast('Seuil mis à jour !', 'success'); setTimeout(() => { this.seuilSaved = false; this.showSeuilModal = false; }, 1600); },
            error: () => { this.seuilSaving = false; this.showToast('Erreur lors de la sauvegarde.', 'error'); },
          });
        } else {
          this.seuilSaving = false;
          this.showToast('Erreur lors de la sauvegarde.', 'error');
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODAL MESURE — CRUD COMPLET
  // ═══════════════════════════════════════════════════════════════════════════

  openAddMesure(): void {
    this.editingMesure = null;
    this.mesureForm.reset({
      valeur: '', dateMesure: new Date().toISOString().slice(0, 16),
      sourceDonnee: 'Saisie manuelle', equipementId: null, commentaire: '',
    });
    this.mesureSaved     = false;
    this.showMesureModal = true;
  }

  openEditMesure(m: Mesure): void {
    this.editingMesure = m;
    this.mesureForm.patchValue({
      valeur:       m.valeur,
      dateMesure:   m.dateMesure?.slice(0, 16) ?? new Date().toISOString().slice(0, 16),
      sourceDonnee: m.sourceDonnee,
      equipementId: m.equipementId ?? null,
      commentaire:  m.commentaire  ?? '',
    });
    this.mesureSaved     = false;
    this.showMesureModal = true;
  }

  closeMesureModal(): void {
    this.showMesureModal = false;
    this.editingMesure   = null;
    this.mesureSaved     = false;
  }

  saveMesure(): void {
    if (this.mesureForm.invalid) { this.mesureForm.markAllAsTouched(); return; }
    this.mesureSaving = true;

    const v = this.mesureForm.value;

    const dateMesure = v.dateMesure
      ? new Date(v.dateMesure).toISOString()
      : new Date().toISOString();

    const equipementId =
      v.equipementId !== null && v.equipementId !== undefined && v.equipementId !== ''
        ? Number(v.equipementId)
        : null;

    const energieNom = this.energieNomApi;

    if (!energieNom) {
      this.mesureSaving = false;
      this.showToast('Données énergie non chargées. Rafraîchissez la page.', 'warn');
      return;
    }

    // ── Diagnostic JWT complet ──────────────────────────────────────────────
    this._logJwtDiagnostic(energieNom);
    // ────────────────────────────────────────────────────────────────────────

    const isEdit = !!this.editingMesure;
    const dto: any = {
      energieNom,
      valeur:       Number(v.valeur),
      dateMesure,
      sourceDonnee: v.sourceDonnee?.trim() || 'Saisie manuelle',
      commentaire:  v.commentaire?.trim()  || '',
      ...(equipementId !== null ? { equipementId } : {}),
    };

    console.log('[saveMesure gaz] DTO complet =', JSON.stringify(dto));

    const obs = isEdit
      ? this.api.updateMesure(this.editingMesure!.idMesure, dto)
      : this.api.createMesure(dto);

    obs.subscribe({
      next: (result: any) => {
        this.mesureSaving = false;
        this.mesureSaved  = true;
        this.showToast(isEdit ? 'Mesure modifiée !' : 'Mesure enregistrée !', 'success');

        if (!isEdit && result) {
          try {
            const newM = this.normalizeMesure(result);
            if (Number(newM.energieId) === this.gazId) {
              this.mesures = [newM, ...this.mesures];
              this.syncSeuilsActuelles();
              this.computeComparaison();
            }
          } catch (_) {}
        }

        setTimeout(() => {
          this.mesureSaved     = false;
          this.showMesureModal = false;
          this.editingMesure   = null;
          this.loadAll();
        }, 1600);
      },
      error: (err: any) => {
        this.mesureSaving = false;
        console.error('[saveMesure gaz] Erreur API :', err);
        console.error('[saveMesure gaz] Status :', err?.status, '| Body :', JSON.stringify(err?.error));

        const apiMsg =
          err?.error?.message ||
          err?.error?.title   ||
          err?.error?.detail  ||
          (err?.status === 403
            ? 'Accès refusé (403) — vérifiez votre rôle et le nom de l\'énergie en BDD'
            : null) ||
          err?.message        ||
          'Erreur lors de la sauvegarde.';

        this.showToast(apiMsg, 'error');
      },
    });
  }

  confirmDelete(m: Mesure): void {
    this.mesureToDelete          = m;
    this.showDeleteMesureConfirm = true;
  }

  cancelDeleteMesure(): void {
    this.showDeleteMesureConfirm = false;
    this.mesureToDelete          = null;
  }

  deleteMesure(): void {
    if (!this.mesureToDelete) return;
    this.deleteSaving = true;
    const id = this.mesureToDelete.idMesure;

    this.api.deleteMesure(id).subscribe({
      next: () => {
        this.mesures                 = this.mesures.filter(m => m.idMesure !== id);
        this.deleteSaving            = false;
        this.showDeleteMesureConfirm = false;
        this.mesureToDelete          = null;
        this.syncSeuilsActuelles();
        this.computeComparaison();
        this.showToast('Mesure supprimée.', 'success');
      },
      error: (err: any) => {
        this.deleteSaving = false;
        console.error('[deleteMesure gaz] Erreur API :', err);
        this.showToast('Erreur lors de la suppression.', 'error');
      },
    });
  }

  exportCSV(): void {
    const headers = ['ID', 'Valeur (m³)', 'Source', 'Équipement', 'Commentaire', 'Date mesure', 'Statut'];
    const rows = this.filteredMesures.map(m => [
      m.idMesure, m.valeur, m.sourceDonnee,
      m.equipement?.nom || this.getEquipNom(m.equipementId),
      m.commentaire || '—',
      new Date(m.dateMesure).toLocaleString('fr-FR'),
      this.isAboveThreshold(m.valeur) ? 'Dépassement' : 'Normal',
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `mesures_gaz_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    this.showToast('Export CSV téléchargé.', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODAL ALERTE
  // ═══════════════════════════════════════════════════════════════════════════

  openAddAlerte(): void { this.openAlerteModal(); }

  openAlerteModal(): void {
    this.editingAlerte = null;
    this.alerteForm.reset({ type: 'Consommation élevée', severite: 'Normale', seuil: 0 });
    this.alerteSaved     = false;
    this.showAlerteModal = true;
  }

  openEditAlerte(a: AlerteExt): void {
    this.editingAlerte = a;
    this.alerteForm.patchValue({
      type: a.type, severite: a.severite, seuil: a.seuil,
      message: a.message, equipementId: a.equipementId ?? '',
    });
    this.alerteSaved     = false;
    this.showAlerteModal = true;
  }

  saveAlerte(): void {
    if (this.alerteForm.invalid) { this.alerteForm.markAllAsTouched(); return; }
    this.alerteSaving = true;
    const v = this.alerteForm.value;
    setTimeout(() => {
      if (this.editingAlerte) {
        const idx = this.alertes.findIndex(a => a.idAlerte === this.editingAlerte!.idAlerte);
        if (idx >= 0) this.alertes[idx] = { ...this.alertes[idx], ...v };
        this.alertes = [...this.alertes]; this.alertesApi = this.alertes;
      } else {
        const nouv: AlerteExt = {
          idAlerte: Date.now(), type: v.type, severite: v.severite, message: v.message,
          seuil: +(v.seuil) || 0, traite: false, dateCreation: new Date().toISOString(),
          equipementId: v.equipementId || null, sourceAuto: false,
        };
        this.alertes = [nouv, ...this.alertes]; this.alertesApi = this.alertes;
      }
      this.alerteSaving = false; this.alerteSaved = true;
      this.showToast(this.editingAlerte ? 'Alerte modifiée !' : 'Alerte créée !', 'success');
      setTimeout(() => { this.alerteSaved = false; this.showAlerteModal = false; this.editingAlerte = null; }, 1600);
    }, 600);
  }

  traiterAlerte(a: AlerteExt): void {
    a.traite = true; this.alertes = [...this.alertes]; this.alertesApi = this.alertes;
    this.showToast('Alerte traitée.', 'success');
  }

  confirmDeleteAlerte(a: AlerteExt): void {
    this.alerteToDelete = a; this.showDeleteAlerteConfirm = true;
  }

  deleteAlerte(): void {
    const target = this.alerteToDelete;
    if (!target) return;
    this.alertes                 = this.alertes.filter(x => x.idAlerte !== target.idAlerte);
    this.alertesApi              = this.alertes;
    this.showDeleteAlerteConfirm = false;
    this.alerteToDelete          = null;
    this.showToast('Alerte supprimée.', 'info');
  }

  exportAlertes(): void { this.exportRapportAlertes(); }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMANDATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  appliquerRecommandation(r: RecommandationExt): void {
    r.applique           = true;
    this.recommandations = [...this.recommandations];
    this.showToast('Recommandation appliquée !', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSE IA
  // ═══════════════════════════════════════════════════════════════════════════

  lancerAnalyseIA(): void {
    if (this.iaLoading) return;
    this.iaLoading = true; this.iaAnalyse = '';
    const prompt =
      `Tu es un expert en efficacité énergétique. Analyse cette consommation de gaz :\n` +
      `- Total : ${this.totalConsommation} m³\n- Moyenne : ${this.moyenneMesures} m³\n` +
      `- Max : ${this.maxMesure} m³ | Min : ${this.minMesure} m³\n` +
      `- Mesures : ${this.totalMesures} | Tendance : ${this.tendanceLabel}\n` +
      `- Alertes actives : ${this.alertesActives} | Anomalies : ${this.anomaliesCount}\n` +
      `- Coût estimé : ${this.coutTotal} DT\n\nDonne un diagnostic et des recommandations concrètes pour réduire la consommation.`;
    this.api.ollamaChat(prompt).subscribe({
      next:  (res: any) => { this.iaLoading = false; this.iaAnalyse = res.response ?? res.message ?? JSON.stringify(res); },
      error: ()         => { this.iaLoading = false; this.iaAnalyse = 'Service IA indisponible. Vérifiez la connexion Ollama.'; },
    });
  }

  toggleIaChat(): void { this.showIaChat = !this.showIaChat; }

  envoyerIaChat(): void {
    if (!this.iaChatInput.trim() || this.iaChatLoading) return;
    const question = this.iaChatInput.trim();
    this.iaChatInput = ''; this.iaChatLoading = true; this.iaChat = '';
    const prompt =
      `Contexte Wicmic Gaz — Total : ${this.totalConsommation} m³, ` +
      `Moyenne : ${this.moyenneMesures} m³, Tendance : ${this.tendance}.\nQuestion : ${question}`;
    this.api.ollamaChat(prompt).subscribe({
      next:  (res: any) => { this.iaChatLoading = false; this.iaChat = res.response ?? ''; },
      error: ()         => { this.iaChatLoading = false; this.iaChat = 'Service IA indisponible.'; },
    });
  }

  sendChat(): void {
    const msg = this.chatInput.trim();
    if (!msg || this.chatLoading) return;
    this.messages.push({ role: 'user', content: msg, time: new Date() });
    this.chatInput = ''; this.chatLoading = true; this._scrollChat();
    this.api.ollamaChat(msg).subscribe({
      next:  (res: any) => { this.messages.push({ role: 'assistant', content: res.response, time: new Date() }); this.chatLoading = false; this._scrollChat(); },
      error: ()         => { this.messages.push({ role: 'assistant', content: 'Service IA indisponible.', time: new Date() }); this.chatLoading = false; this._scrollChat(); },
    });
  }

  private _scrollChat(): void {
    setTimeout(() => {
      if (this.chatScrollRef?.nativeElement)
        this.chatScrollRef.nativeElement.scrollTop = this.chatScrollRef.nativeElement.scrollHeight;
    }, 50);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RAPPORTS
  // ═══════════════════════════════════════════════════════════════════════════

  telechargerRapport(type: string): void {
    switch (type) {
      case 'mensuel':         this.exportRapport(); break;
      case 'csv':             this.exportCSV(); break;
      case 'alertes':         this.exportRapportAlertes(); break;
      case 'anomalies':       this.exportRapportAnomalies(); break;
      case 'recommandations': this.exportRapportRecommandations(); break;
      case 'complet':         this.exportRapportComplet(); break;
    }
  }

  exportRapport(): void {
    const sep = '═'.repeat(60); const sub = '─'.repeat(60);
    const lines = [
      'WICMIC — Rapport gaz', sep,
      `Généré le : ${new Date().toLocaleString('fr-FR')}`, sub,
      `Total mesures       : ${this.totalMesures}`,
      `Consommation totale : ${this.totalConsommation} m³`,
      `Moyenne             : ${this.moyenneMesures} m³`,
      `Max                 : ${this.maxMesure} m³ | Min : ${this.minMesure} m³`,
      `Coût total estimé   : ${this.coutTotal} DT`,
      `Tendance            : ${this.tendanceLabel}`, sub,
      `Alertes actives     : ${this.alertesActives} (dont ${this.alertesCritiques} critiques)`,
      `Anomalies actives   : ${this.anomaliesCount}`,
      `Économie potentielle: ${this.economiePotentielle} DT`,
    ];
    this.download(lines.join('\n'), `rapport_gaz_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
    this.showToast('Rapport téléchargé.', 'success');
  }

  private exportRapportAlertes(): void {
    const headers = ['ID', 'Type', 'Message', 'Seuil (m³)', 'Sévérité', 'Équipement', 'Statut', 'Date'];
    const rows = this.alertes.map(a => [
      a.idAlerte, a.type, a.message, a.seuil, a.severite,
      this.getEquipNom(a.equipementId),
      a.traite ? 'Traitée' : 'Active',
      new Date(a.dateCreation).toLocaleString('fr-FR'),
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `alertes_gaz_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    this.showToast('Export alertes téléchargé.', 'success');
  }

  private exportRapportAnomalies(): void {
    const sep = '═'.repeat(60);
    const lines = [
      'WICMIC — Rapport anomalies gaz', sep,
      `Généré le : ${new Date().toLocaleString('fr-FR')}`,
      `Anomalies locales : ${this.anomaliesLocales.length}`,
      `Anomalies API     : ${this.anomalies.length}`, sep,
      ...this.anomaliesLocales.map(a =>
        `[${a.resolu ? 'RÉSOLU' : 'ACTIF'}] ${a.description} — ${new Date(a.date).toLocaleDateString('fr-FR')}`
      ),
    ];
    this.download(lines.join('\n'), `anomalies_gaz_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
    this.showToast('Rapport anomalies téléchargé.', 'success');
  }

  private exportRapportRecommandations(): void {
    const sep = '═'.repeat(60);
    const lines = [
      'WICMIC — Recommandations gaz', sep,
      `En attente : ${this.recommandationsEnCours.length} | Appliquées : ${this.recommandationsAppliques.length}`, sep,
      ...this.recommandations.map(r => `[${r.applique ? 'APPLIQUÉ' : 'EN ATTENTE'}] [${r.priorite}] ${r.texte}`),
    ];
    this.download(lines.join('\n'), `recommandations_gaz_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
    this.showToast('Rapport recommandations téléchargé.', 'success');
  }

  private exportRapportComplet(): void {
    const sep = '═'.repeat(60);
    const lines = [
      'WICMIC — Rapport complet gaz', sep,
      `Généré le : ${new Date().toLocaleString('fr-FR')}`, sep,
      `CONSOMMATION`,
      `Total : ${this.totalConsommation} m³ | Moyenne : ${this.moyenneMesures} m³`,
      `Coût : ${this.coutTotal} DT | Tendance : ${this.tendanceLabel}`, sep,
      `ALERTES : ${this.alertesActives} active(s)`,
      `ANOMALIES : ${this.anomaliesCount} active(s)`,
      `RECOMMANDATIONS : ${this.recommandationsEnCours.length} en attente`,
    ];
    this.download(lines.join('\n'), `rapport_complet_gaz_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
    this.showToast('Rapport complet téléchargé.', 'success');
  }

  private download(content: string, filename: string, type: string): void {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARAISON DE PÉRIODES
  // ═══════════════════════════════════════════════════════════════════════════

  computeComparaison(): void {
    const now = new Date();
    const getRange = (decalage: number): { debut: Date; fin: Date; label: string } => {
      switch (this.comparePeriode) {
        case 'trimestre': {
          const q    = Math.floor(now.getMonth() / 3) - decalage;
          const year = now.getFullYear() + Math.floor(q / 4);
          const qi   = ((q % 4) + 4) % 4;
          return { debut: new Date(year, qi * 3, 1), fin: new Date(year, qi * 3 + 3, 0, 23, 59, 59), label: `T${qi + 1} ${year}` };
        }
        case 'annee': {
          const y = now.getFullYear() - decalage;
          return { debut: new Date(y, 0, 1), fin: new Date(y, 11, 31, 23, 59, 59), label: String(y) };
        }
        default: {
          const month = now.getMonth() - decalage;
          const year  = now.getFullYear() + Math.floor(month / 12);
          const m     = ((month % 12) + 12) % 12;
          return {
            debut: new Date(year, m, 1), fin: new Date(year, m + 1, 0, 23, 59, 59),
            label: new Date(year, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          };
        }
      }
    };
    const stat = (range: { debut: Date; fin: Date; label: string }): StatPeriode => {
      const ms    = this.mesures.filter(m => { const d = new Date(m.dateMesure); return d >= range.debut && d <= range.fin; });
      const total = +ms.reduce((s, m) => s + m.valeur, 0).toFixed(1);
      return { label: range.label, total, nbMesures: ms.length, cout: +(total * this.tarifGaz).toFixed(2) };
    };
    this.statPeriodeCourante   = stat(getRange(0));
    this.statPeriodePrecedente = stat(getRange(1));
    this.variationConsommation = this.statPeriodePrecedente.total > 0
      ? Math.round(((this.statPeriodeCourante.total - this.statPeriodePrecedente.total) / this.statPeriodePrecedente.total) * 100)
      : this.statPeriodeCourante.total > 0 ? 100 : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHART
  // ═══════════════════════════════════════════════════════════════════════════

  get chartDays(): number { return this.chartPeriod === '7j' ? 7 : this.chartPeriod === '30j' ? 30 : 90; }

  private buildPoints(daysAgo: number): { label: string; value: number }[] {
    const now = new Date();
    const result: { label: string; value: number }[] = [];
    for (let i = this.chartDays - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i - daysAgo);
      const label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const dayM  = this.mesures.filter(m => new Date(m.dateMesure).toDateString() === d.toDateString());
      const val   = dayM.length ? +(dayM.reduce((s, m) => s + m.valeur, 0) / dayM.length).toFixed(1) : 0;
      result.push({ label, value: val });
    }
    return result;
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
    const raw    = this.buildPoints(0);
    const maxVal = Math.max(...raw.map(p => p.value), this.alertThreshold, 1) * 1.15;
    return this.toChartPoints(raw, maxVal);
  }

  get hasChartData(): boolean { return this.chartPoints.some(p => p.value > 0); }

  get barChartData(): ChartPoint[] {
    const raw    = this.buildPoints(0);
    const maxVal = Math.max(...raw.map(p => p.value), this.alertThreshold, 1) * 1.15;
    const H      = this.CHART_H - this.CHART_PAD_Y * 2;
    const W      = this.CHART_W - this.CHART_PAD_X * 2;
    const bw     = Math.max(4, (W / Math.max(raw.length, 1)) * 0.6);
    return raw.map((p, i) => {
      const cx = this.CHART_PAD_X + (i / Math.max(raw.length - 1, 1)) * W;
      const h  = (p.value / maxVal) * H;
      return { label: p.label, value: p.value, x: cx - bw / 2, y: this.CHART_PAD_Y + H - h, width: bw, height: h };
    });
  }

  private pathFromPoints(pts: ChartPoint[]): string {
    if (!pts.filter(p => p.value > 0).length) return '';
    let d = ''; let inPath = false;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].value > 0) {
        if (!inPath) { d += `M ${pts[i].x} ${pts[i].y}`; inPath = true; }
        else {
          const cpX = (pts[i - 1].x + pts[i].x) / 2;
          d += ` C ${cpX} ${pts[i - 1].y} ${cpX} ${pts[i].y} ${pts[i].x} ${pts[i].y}`;
        }
      } else { inPath = false; }
    }
    return d;
  }

  private areaFromPoints(pts: ChartPoint[]): string {
    if (!pts.length) return '';
    const bottom = this.CHART_H - this.CHART_PAD_Y;
    let d = `M ${pts[0].x} ${bottom} L ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cpX = (pts[i - 1].x + pts[i].x) / 2;
      d += ` C ${cpX} ${pts[i - 1].y} ${cpX} ${pts[i].y} ${pts[i].x} ${pts[i].y}`;
    }
    d += ` L ${pts[pts.length - 1].x} ${bottom} Z`;
    return d;
  }

  get linePath(): string { return this.pathFromPoints(this.chartPoints); }
  get areaPath(): string { return this.areaFromPoints(this.chartPoints.filter(p => p.value > 0)); }

  get yAxisLabels(): { y: number; label: string }[] {
    const raw    = this.buildPoints(0);
    const maxVal = Math.max(...raw.map(p => p.value), this.alertThreshold, 1) * 1.15;
    const H      = this.CHART_H - this.CHART_PAD_Y * 2;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉNERGIE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  getEnergieTotal(energieId: number): number {
    return +(this.mesures
      .filter(m => Number(m.energieId) === Number(energieId))
      .reduce((s, m) => s + (m.valeur ?? 0), 0)
      .toFixed(1));
  }

  getEnergieUnite(energieId: number): string {
    const e = this.energies.find(e => Number(e.idEnergie) === Number(energieId));
    if (e?.unite) return e.unite;
    for (const m of this.mesures) {
      if (Number(m.energieId) === Number(energieId) && m.energie?.unite) return m.energie.unite;
    }
    return 'm³';
  }

  getEnergieNom(energieId: number): string {
    if (!energieId) return '—';
    const found = this.energies.find(e => Number(e.idEnergie) === Number(energieId));
    if (found?.nom) return found.nom;
    for (const m of this.mesures) {
      if (Number(m.energieId) === Number(energieId) && m.energie?.nom) return m.energie.nom;
    }
    return energieId === 2 ? 'Gaz' : `Énergie ${energieId}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉQUIPEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  get filteredEquipements(): Equipement[] {
    let list = [...this.equipements];
    if (this.searchEquip) {
      const q = this.searchEquip.toLowerCase();
      list = list.filter(e => e.nom.toLowerCase().includes(q) || e.typeEquipement.toLowerCase().includes(q));
    }
    if (this.filterEquipType)   list = list.filter(e => e.typeEquipement === this.filterEquipType);
    if (this.filterEquipStatut) list = list.filter(e => (e.statut || 'Actif') === this.filterEquipStatut);
    return list;
  }

  get pagedEquipements(): Equipement[] {
    const s = (this.equipPage - 1) * this.equipPerPage;
    return this.filteredEquipements.slice(s, s + this.equipPerPage);
  }

  getEquipAgeAns(e: Equipement): string {
    const dateRef = e.dateMiseEnService || e.dateInstallation;
    if (!dateRef) return '—';
    const ans = Math.floor((Date.now() - new Date(dateRef).getTime()) / (365.25 * 86400000));
    return ans < 1 ? '< 1 an' : `${ans} an${ans > 1 ? 's' : ''}`;
  }

  openAddEquipement(): void {
    this.editingEquipement = null;
    this.equipementForm.reset({ statut: 'Actif', dateInstallation: new Date().toISOString().slice(0, 10) });
    this.equipementSaved    = false;
    this.showEquipementModal = true;
  }

  openEditEquipement(e: Equipement): void {
    this.editingEquipement = e;
    this.equipementForm.patchValue({
      nom:              e.nom,
      typeEquipement:   e.typeEquipement,
      statut:           e.statut || 'Actif',
      puissance:        e.puissance,
      localisation:     e.localisation,
      dateInstallation: (e.dateMiseEnService || e.dateInstallation)?.slice(0, 10) ?? '',
      energieId:        e.energieId ?? '',
      zoneId:           e.zoneId    ?? '',
    });
    this.equipementSaved    = false;
    this.showEquipementModal = true;
  }

  saveEquipement(): void {
    if (this.equipementForm.invalid) { this.equipementForm.markAllAsTouched(); return; }
    this.equipementSaving = true;
    const v   = this.equipementForm.value;
    const dto = {
      nom:               v.nom,
      typeEquipement:    v.typeEquipement,
      statut:            v.statut,
      puissance:         v.puissance,
      localisation:      v.localisation,
      dateMiseEnService: v.dateInstallation ? new Date(v.dateInstallation).toISOString() : null,
      energieId:         v.energieId || null,
      zoneId:            v.zoneId    || null,
    };
    const obs = this.editingEquipement
      ? this.api.updateEquipement(this.editingEquipement.idEquipement, dto)
      : this.api.createEquipement(dto);
    obs.subscribe({
      next:  () => { this.equipementSaving = false; this.equipementSaved = true; this.showToast(this.editingEquipement ? 'Équipement modifié !' : 'Équipement ajouté !', 'success'); setTimeout(() => { this.equipementSaved = false; this.showEquipementModal = false; this.loadAll(); }, 1600); },
      error: () => { this.equipementSaving = false; this.showToast('Erreur.', 'error'); },
    });
  }

  confirmDeleteEquipement(e: Equipement): void {
    this.equipementToDelete          = e;
    this.showDeleteEquipementConfirm = true;
  }

  cancelDeleteEquipement(): void {
    this.showDeleteEquipementConfirm = false;
    this.equipementToDelete          = null;
  }

  deleteEquipement(): void {
    if (!this.equipementToDelete) return;
    this.api.deleteEquipement(this.equipementToDelete.idEquipement).subscribe({
      next:  () => { this.showToast('Équipement supprimé.', 'info'); this.showDeleteEquipementConfirm = false; this.equipementToDelete = null; this.loadAll(); },
      error: () => { this.showToast('Erreur.', 'error'); },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════════════════════════════════════

  showToast(msg: string, type: 'success'|'error'|'info'|'warn'): void {
    const id = ++this.toastCounter;
    this.toasts.unshift({ id, msg, type });
    setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 4000);
  }

  dismissToast(id: number): void { this.toasts = this.toasts.filter(t => t.id !== id); }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD ALL
  // ═══════════════════════════════════════════════════════════════════════════

  loadAll(): void {
    this.loading   = true;
    this.apiErrors = {};
    let done = 0;
    const total = 6;
    const check = () => {
      if (++done === total) {
        this.loading    = false;
        this.alertesApi = this.alertes;
        this.initSeuilsFromEnergies();
        this.syncSeuilsActuelles();
        this.computeComparaison();
      }
    };

    this.api.getMesures().subscribe({
      next: (d: any) => {
        this.mesures = (d as any[])
          .map((m: any) => this.normalizeMesure(m))
          .filter(m => Number(m.energieId) === this.gazId);
        check();
      },
      error: () => { this.apiErrors['mesures'] = true; check(); },
    });

    this.api.getAlertes().subscribe({
      next:  (d: any) => { this.alertes = (d as any[]).map((a: any) => this.normalizeAlerte(a)); this.alertesApi = this.alertes; check(); },
      error: ()       => { this.apiErrors['alertes'] = true; check(); },
    });

    this.api.getAnomalies().subscribe({
      next: (d: any) => {
        this.anomalies = (d as any[]).map((a: any) => this.normalizeAnomalie(a));
        this.anomalies.forEach(a => { if (!this.progressMap.has(a.id ?? 0)) this.progressMap.set(a.id ?? 0, a.resolu ? 100 : 0); });
        check();
      },
      error: () => { this.apiErrors['anomalies'] = true; check(); },
    });

    this.api.getRecommandations().subscribe({
      next:  (d: any) => { this.recommandations = d as RecommandationExt[]; check(); },
      error: ()       => { this.apiErrors['recommandations'] = true; check(); },
    });

    this.api.getEquipements().subscribe({
      next:  (d: any) => { this.equipements = (d as any[]).map((e: any) => this.normalizeEquipement(e)); check(); },
      error: ()       => { this.apiErrors['equipements'] = true; check(); },
    });

    this.api.getEnergies().subscribe({
      next:  (d: any) => { this.energies = (d as any[]).map((e: any) => this.normalizeEnergie(e)); check(); },
      error: ()       => { this.apiErrors['energies'] = true; check(); },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTIC JWT & ÉNERGIE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Décode le JWT depuis localStorage/sessionStorage et loggue tous les claims.
   * Appelé avant chaque saveMesure pour diagnostiquer les erreurs 403.
   */
  private _logJwtDiagnostic(energieNomEnvoye: string): void {
    const TOKEN_KEYS = [
      'token', 'jwt', 'access_token', 'auth_token', 'id_token',
      'authToken', 'jwtToken', 'Bearer', 'wicmic_token',
    ];
    let token = '';
    let foundKey = '';
    for (const k of TOKEN_KEYS) {
      token = localStorage.getItem(k) ?? sessionStorage.getItem(k) ?? '';
      if (token) { foundKey = k; break; }
    }

    console.groupCollapsed('[GAZ] Diagnostic pré-envoi mesure');
    console.log('► energieNom envoyé  :', energieNomEnvoye);
    console.log('► energies chargées  :', this.energies.map(e => `id=${e.idEnergie} nom="${e.nom}"`));
    console.log('► gazId              :', this.gazId);
    console.log('► currentUser.role   :', this.currentUser?.role ?? '(non défini)');
    console.log('► canEdit            :', this.canEdit);

    if (!token) {
      console.warn('► JWT              : INTROUVABLE');
      console.warn('► localStorage keys:', Object.keys(localStorage));
      console.warn('► sessionStorage keys:', Object.keys(sessionStorage));
    } else {
      console.log('► JWT clé           :', foundKey);
      try {
        const payload64 = token.split('.')[1];
        const decoded   = JSON.parse(atob(payload64.replace(/-/g, '+').replace(/_/g, '/')));
        console.log('► JWT claims complets:', decoded);

        // Cherche TOUTES les clés contenant "role"
        const roleKeys = Object.keys(decoded).filter(k => k.toLowerCase().includes('role'));
        if (roleKeys.length) {
          roleKeys.forEach(k => console.log(`► JWT claim rôle [${k}]:`, decoded[k]));
        } else {
          console.warn('► JWT : aucun claim "role" trouvé parmi', Object.keys(decoded));
        }

        // Expiration
        if (decoded.exp) {
          const expDate = new Date(decoded.exp * 1000);
          const expired = expDate < new Date();
          console.log(`► JWT exp           : ${expDate.toLocaleString('fr-FR')} ${expired ? '⚠️ EXPIRÉ' : '✅ valide'}`);
        }
      } catch (e) {
        console.warn('► JWT : impossible de décoder', e);
      }
    }
    console.groupEnd();
  }

  /**
   * Lit le claim rôle directement depuis le JWT (tous les noms de claim courants).
   * Retourne '' si le token est absent ou illisible.
   */
  private _getRoleFromJwt(): string {
    const TOKEN_KEYS = [
      'token', 'jwt', 'access_token', 'auth_token', 'id_token',
      'authToken', 'jwtToken', 'Bearer', 'wicmic_token',
    ];
    let token = '';
    for (const k of TOKEN_KEYS) {
      token = localStorage.getItem(k) ?? sessionStorage.getItem(k) ?? '';
      if (token) break;
    }
    if (!token) return '';
    try {
      const payload64 = token.split('.')[1];
      const decoded   = JSON.parse(atob(payload64.replace(/-/g, '+').replace(/_/g, '/')));
      // Claim standard ASP.NET Core Identity
      const msRole = decoded['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
      if (msRole) return Array.isArray(msRole) ? msRole.join(',') : String(msRole);
      // Claims courants
      for (const k of ['role', 'Role', 'roles', 'Roles', 'authorities', 'groups']) {
        if (decoded[k]) {
          const val = decoded[k];
          return Array.isArray(val) ? val.join(',') : String(val);
        }
      }
    } catch (_) {}
    return '';
  }

  logout(): void { this.auth.logout(); }
}