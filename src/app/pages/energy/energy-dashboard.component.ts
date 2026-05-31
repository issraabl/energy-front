// ══════════════════════════════════════════════════════════════════════════════
// energy-dashboard.component.ts 
// ══════════════════════════════════════════════════════════════════════════════

import { Component, OnInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  ReactiveFormsModule, FormsModule,
  FormBuilder, FormGroup, Validators
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import * as XLSX from 'xlsx';

import { ApiService }  from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { AiService, PrevisionIA, BenchmarkIA } from '../../core/ai/ai.service';
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

// ─── Interfaces IA ────────────────────────────────────────────────────────────

interface AnomalieIA {
  severite:  string;
  energie:   string;
  unite:     string;
  date:      string;
  valeur:    number;
  moyenne:   number;
  ecart_pct: number;
  type:      string;
  methode:   string;
}

interface AnomaliesIAResult {
  score_sante:  number;
  resume:       string;
  nb_critiques: number;
  nb_hautes:    number;
  nb_normales:  number;
  anomalies:    AnomalieIA[];
}

interface RecommandationIA {
  titre:            string;
  description:      string;
  priorite:         string;
  economie_estimee: number;
  delai:            string;
  energie_ciblee:   string;
  categorie:        string;
}

interface RecommandationsIAResult {
  resume:          string;
  economie_totale: number;
  nb_haute:        number;
  recommandations: RecommandationIA[];
}

interface StatEnergie {
  mois_actuel:    number;
  mois_precedent: number;
  variation_pct:  number;
  moyenne:        number;
  prevision:      number;
  tendance:       'up'|'down'|'flat';
  r2:             number;
  unite:          string;
}

interface RapportIA {
  date_generation:  string;
  nb_mesures:       number;
  periode:          string;
  score_sante:      number;
  nb_anomalies:     number;
  resume_executif:  string;
  points_cles:      string[];
  decisions:        string[];
  stats_energies:   Record<string, StatEnergie>;
  anomalies_top3:   { energie: string; date: string; description: string; ecart_pct: number }[];
}

// ─── Noms canoniques des énergies ────────────────────────────────────────────
const NOM_ELECTRICITE = 'Electricité';
const NOM_EAU         = 'Eau';
const NOM_GAZOIL      = 'Gazoil';

const TARIFS_PAR_NOM: Record<string, number> = {
  [NOM_ELECTRICITE]: 0.28,
  [NOM_EAU]:         0.85,
  [NOM_GAZOIL]:      2.10,
};

// ─── Détection sociale ────────────────────────────────────────────────────────
const SOCIAL_WORDS = new Set([
  'merci', 'thanks', 'thank you', 'super', 'parfait', 'ok', 'okay',
  'bien', 'bonne journée', 'bonsoir', 'bonjour', 'salut', 'hello',
  'au revoir', 'bye', 'nickel', 'top', 'cool', "d'accord", 'daccord',
  'compris', 'vu', '👍', '🙏', '😊',
]);

const BUSINESS_WORDS = [
  'consomm', 'kwh', 'énergi', 'energi', 'alert', 'équip', 'equip',
  'mesur', 'anomali', 'rapport', 'score', 'prévi', 'previ',
  'benchmark', 'eau', 'gazoil', 'électri', 'electri', 'compresseur',
  'réduct', 'reduc', 'seuil', 'tendance', 'analyse', 'factur',
];

function isSocialMessage(msg: string): boolean {
  const normalized = msg.trim().toLowerCase().replace(/[!.,?]/g, '');
  const words      = normalized.split(/\s+/);
  return SOCIAL_WORDS.has(normalized)
    || (words.length <= 4 && !BUSINESS_WORDS.some(kw => normalized.includes(kw)));
}

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

  // ── Pending delete confirmations (inline) ─────────────────────────────────
  pendingDeleteIds = new Set<number>();

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
  private readonly RAG_URL = 'http://localhost:8000';

  // ── Benchmarking ───────────────────────────────────────────────────────────
  benchmarkData: BenchmarkItem[] = [];
  rankTimeline:  { label: string; pct: number }[] = [];

  // ── IA Status ─────────────────────────────────────────────────────────────
  aiServiceOnline  = false;
  aiLoading        = false;
  aiLoadingBench   = false;
  benchmarkIA: BenchmarkIA | null = null;
  previsionRaisonnement = '';

  // ── Prévisions ─────────────────────────────────────────────────────────────
  previsionMoisProchain = {
    elec: 0, eau: 0, gazoil: 0, fiabilite: 0,
    elecTrend: 'flat' as 'up'|'down'|'flat',
    elecVar: '0', hasEnoughData: false,
  };
  previsionRecos: { titre: string; description: string; economie: number; urgence: string }[] = [];
  forecastPoints: ChartPoint[] = [];

  // ── Anomalies IA ──────────────────────────────────────────────────────────
  aiLoadingAnomalies = false;
  anomaliesIA: AnomaliesIAResult | null = null;

  // ── Recommandations IA ────────────────────────────────────────────────────
  aiLoadingRecos = false;
  recommandationsIA: RecommandationsIAResult | null = null;

  // ── Rapport IA ────────────────────────────────────────────────────────────
  aiLoadingRapport = false;
  rapportIA: RapportIA | null = null;

  // ── Email Rapport IA ──────────────────────────────────────────────────────
  showEmailModal    = false;
  emailDestinataire = '';
  emailNom          = '';
  emailObjet        = '';
  emailObjetDefault = '';
  emailNote         = '';
  emailSending      = false;
  emailSent         = false;
  emailError        = '';

  min  = Math.min;
  Math = Math;

  // ── Mesures table ─────────────────────────────────────────────────────────
  mesuresTab: 'table'|'chart' = 'chart';
  mesurePage = 1; mesurePerPage = 10;
  searchMesure = ''; filterMesureEnergie = '';

  constructor(
    private api:   ApiService,
    private auth:  AuthService,
    private fb:    FormBuilder,
    private cdr:   ChangeDetectorRef,
    private aiSvc: AiService,
    private http:  HttpClient,
  ) {
    this.initForms();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Résolution des IDs par nom
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
  // Polling de job async FastAPI
  // ══════════════════════════════════════════════════════════════════════════

  private pollJob<T>(
    jobId: string,
    url: string,
    onSuccess: (result: T) => void,
    onError: () => void,
    attempts = 0,
    maxAttempts = 60
  ): void {
    if (attempts >= maxAttempts) {
      console.warn(`[pollJob] Timeout pour job ${jobId}`);
      onError();
      return;
    }
    this.http.get<{ status: string; result: T }>(url)
      .pipe(timeout(8000), catchError(() => of(null)))
      .subscribe(res => {
        if (!res || res.status === 'error') {
          console.warn(`[pollJob] Job ${jobId} en erreur`);
          onError();
          return;
        }
        if (res.status === 'done') {
          onSuccess(res.result);
          return;
        }
        setTimeout(() => this.pollJob(jobId, url, onSuccess, onError, attempts + 1, maxAttempts), 2000);
      });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  ngOnInit(): void {
    this.loadAll();
    this.clockInterval = setInterval(() => { this.currentTime = new Date(); }, 1000);
    this.messages = [{
      role:    'assistant',
      content: 'Bonjour ! Je suis l\'assistant IA de Wicmic Energy. Posez-moi vos questions sur vos consommations, alertes ou équipements.',
      time:    new Date(),
    }];
    this.aiSvc.checkHealth().subscribe(res => {
      this.aiServiceOnline = res?.status === 'ok';
    });
    // lancerDetectionAnomalies() est appelé dans loadAll() après chargement complet.
    // Pas de setTimeout ici — évite toute race condition.
  }

  ngOnDestroy(): void { clearInterval(this.clockInterval); }

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════

  get nowIso():      string  { return new Date().toISOString().slice(0, 16); }
  get todayDate():   string  { return new Date().toISOString().slice(0, 10); }
  get currentYear(): number  { return new Date().getFullYear(); }

  // ══════════════════════════════════════════════════════════════════════════
  // Filtre global par date
  // ══════════════════════════════════════════════════════════════════════════

  onDateFilterChange(): void { this.dateQuickPeriod = ''; }

  setDateQuick(period: string): void {
    this.dateQuickPeriod = period;
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    if (period === 'all') { this.dateFilterFrom = ''; this.dateFilterTo = ''; return; }
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
    this.dateFilterFrom = ''; this.dateFilterTo = ''; this.dateQuickPeriod = '';
  }

  get mesuresFiltreesParDate(): Mesure[] {
    return this.mesures.filter(m => {
      const d = new Date(m.dateMesure);
      if (this.dateFilterFrom && d < new Date(this.dateFilterFrom)) return false;
      if (this.dateFilterTo   && d > new Date(this.dateFilterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  get alertesFiltreesParDate(): AlerteExt[] {
    return this.alertes.filter(a => {
      const d = new Date(a.dateCreation);
      if (this.dateFilterFrom && d < new Date(this.dateFilterFrom)) return false;
      if (this.dateFilterTo   && d > new Date(this.dateFilterTo + 'T23:59:59')) return false;
      return true;
    });
  }

  get dateRangeLabel(): string {
    if (!this.dateFilterFrom && !this.dateFilterTo) return 'Toutes les données';
    const fmt = (s: string) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    if (this.dateFilterFrom && this.dateFilterTo) return `${fmt(this.dateFilterFrom)} → ${fmt(this.dateFilterTo)}`;
    if (this.dateFilterFrom) return `Depuis le ${fmt(this.dateFilterFrom)}`;
    return `Jusqu'au ${fmt(this.dateFilterTo)}`;
  }

  get coutPeriodeFiltree(): number {
    return +(this.mesuresFiltreesParDate
      .reduce((s, m) => s + m.valeur * this.getTarifById(Number(m.energieId)), 0)
    ).toFixed(2);
  }

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

  getEnergieTotalFiltre(energieId: number): number {
    return +(this.mesuresFiltreesParDate
      .filter(m => Number(m.energieId) === Number(energieId))
      .reduce((s, m) => s + m.valeur, 0)
    ).toFixed(1);
  }

  getEnergiePctFiltre(energieId: number): number {
    const total = this.mesuresFiltreesParDate.reduce((s, m) => s + m.valeur, 0) || 1;
    return Math.round((this.getEnergieTotalFiltre(energieId) / total) * 100);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Exports Excel
  // ══════════════════════════════════════════════════════════════════════════

  private exportXlsx(
    sheets: { name: string; rows: (string | number | null | undefined | boolean)[][] }[],
    filename: string
  ): void {
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      const colWidths: number[] = [];
      sheet.rows.forEach(row => {
        row.forEach((cell, i) => {
          const len = cell != null ? String(cell).length : 0;
          colWidths[i] = Math.max(colWidths[i] ?? 10, len + 2);
        });
      });
      ws['!cols'] = colWidths.map(w => ({ wch: Math.min(w, 60) }));
      XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename);
  }

  exportRapportExcel(): void {
    const mesuresRows: (string | number | null)[][] = [
      ['ID', 'Date', 'Valeur', 'Unité', 'Énergie', 'Équipement', 'Source', 'Commentaire', 'Coût (DT)'],
      ...this.mesuresFiltreesParDate.map(m => [
        m.idMesure,
        new Date(m.dateMesure).toLocaleString('fr-FR'),
        m.valeur,
        this.getEnergieUnite(Number(m.energieId)),
        this.getEnergieNom(Number(m.energieId)),
        m.equipement?.nom ?? '—',
        m.sourceDonnee,
        m.commentaire ?? '',
        +(m.valeur * this.getTarifById(Number(m.energieId))).toFixed(2),
      ]),
    ];
    const resumeRows: (string | number | null)[][] = [
      ['Résumé', ''],
      ['Période', this.dateRangeLabel],
      ['Nombre de mesures', this.mesuresFiltreesParDate.length],
      ['Coût total (DT)', this.coutPeriodeFiltree],
      ['Moyenne', this.moyenneMesuresFiltrees],
      ['Maximum', this.maxMesureFiltre],
      ['Minimum', this.minMesureFiltre],
      ['Score efficacité', `${this.efficiencyScore}/100 (${this.efficiencyGrade})`],
      ['Généré le', new Date().toLocaleString('fr-FR')],
    ];
    this.exportXlsx(
      [{ name: 'Mesures', rows: mesuresRows }, { name: 'Résumé', rows: resumeRows }],
      `rapport_mesures_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    this.showToast('Export Excel rapport téléchargé.', 'success');
  }

  exportMesuresExcel(): void {
    const rows: (string | number | null)[][] = [
      ['ID', 'Date', 'Valeur', 'Unité', 'Énergie', 'Équipement', 'Source', 'Commentaire'],
      ...this.mesuresFiltreesParDate.map(m => [
        m.idMesure,
        new Date(m.dateMesure).toLocaleString('fr-FR'),
        m.valeur,
        this.getEnergieUnite(Number(m.energieId)),
        this.getEnergieNom(Number(m.energieId)),
        m.equipement?.nom ?? '—',
        m.sourceDonnee,
        m.commentaire ?? '',
      ]),
    ];
    this.exportXlsx([{ name: 'Mesures', rows }], `mesures_brut_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Export mesures Excel téléchargé.', 'success');
  }

  exportEquipementsExcel(): void {
    const rows: (string | number | null)[][] = [
      ['ID', 'Nom', 'Type', 'Statut', 'Puissance (kW)', 'Localisation', 'Énergie', 'Date installation', 'Âge', 'Nb mesures'],
      ...this.equipements.map(e => {
        const dateRef = e.dateMiseEnService || e.dateInstallation;
        return [
          e.idEquipement, e.nom, e.typeEquipement, e.statut ?? 'Actif', e.puissance ?? null,
          e.localisation ?? e.zone?.nom ?? '—',
          e.energie?.nom ?? (e.energieId ? this.getEnergieNom(Number(e.energieId)) : '—'),
          dateRef ? new Date(dateRef).toLocaleDateString('fr-FR') : '—',
          this.getEquipAgeAns(e), this.getMesuresForEquip(e),
        ];
      }),
    ];
    this.exportXlsx([{ name: 'Équipements', rows }], `equipements_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Export équipements Excel téléchargé.', 'success');
  }

  exportAlertesExcel(): void {
    const rows: (string | number | null)[][] = [
      ['ID', 'Type', 'Sévérité', 'Message', 'Seuil', 'Source', 'Statut', 'Date'],
      ...this.alertesFiltreesParDate.map(a => [
        a.idAlerte, a.type, a.severite, a.message, a.seuil,
        a.sourceAuto ? 'Auto' : 'Manuel',
        a.traite ? 'Traitée' : 'Active',
        new Date(a.dateCreation).toLocaleString('fr-FR'),
      ]),
    ];
    this.exportXlsx([{ name: 'Alertes', rows }], `alertes_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Export alertes Excel téléchargé.', 'success');
  }

  exportBenchmarkExcel(): void {
    const rows: (string | number | null)[][] = [
      ['Énergie', 'Unité', 'Mois courant', 'Mois précédent', 'Variation (%)', 'Position', 'Insight'],
      ...this.benchmarkData.map(b => [
        b.energie, b.unite, b.moisActuel, b.moisPrecedent,
        b.moisPrecedent > 0 ? b.variation : null,
        b.position === 'better' ? 'Baisse' : b.position === 'same' ? 'Stable' : 'Hausse',
        b.insight,
      ]),
    ];
    this.exportXlsx([{ name: 'Benchmark', rows }], `benchmark_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Export benchmark Excel téléchargé.', 'success');
  }

  exportPrevisionsExcel(): void {
    const prevRows: (string | number | null)[][] = [
      ['Énergie', 'Valeur prévue', 'Unité', 'Tendance', 'Variation (%)', 'Fiabilité (%)'],
      [NOM_ELECTRICITE, this.previsionMoisProchain.elec, this.getEnergieUnite(this.idElec), this.previsionMoisProchain.elecTrend, this.previsionMoisProchain.elecVar, this.previsionMoisProchain.fiabilite],
      [NOM_EAU,         this.previsionMoisProchain.eau,  this.getEnergieUnite(this.idEau),  'flat', null, this.previsionMoisProchain.fiabilite],
      [NOM_GAZOIL,      this.previsionMoisProchain.gazoil, this.getEnergieUnite(this.idGazoil), 'flat', null, this.previsionMoisProchain.fiabilite],
    ];
    const recosRows: (string | number | null)[][] = [
      ['Titre', 'Description', 'Économie estimée (DT)', 'Urgence'],
      ...this.previsionRecos.map(r => [r.titre, r.description, r.economie, r.urgence]),
    ];
    const metaRows: (string | number | null)[][] = [
      ['Métadonnées', ''],
      ['Période de prévision', 'Mois prochain'],
      ['Fiabilité globale (%)', this.previsionMoisProchain.fiabilite],
      ['Raisonnement IA', this.previsionRaisonnement || '—'],
      ['Généré le', new Date().toLocaleString('fr-FR')],
    ];
    this.exportXlsx(
      [{ name: 'Prévisions', rows: prevRows }, { name: 'Recommandations IA', rows: recosRows }, { name: 'Métadonnées', rows: metaRows }],
      `previsions_ia_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
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
      energieId, energie: energieRaw ? this.normalizeEnergie(energieRaw) : null,
      equipementId, equipement: equipRaw ?? null,
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
      energieId, zoneId: e.zoneId ?? e.ZoneId ?? null,
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
      energieNom, energieId,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Seuils
  // ══════════════════════════════════════════════════════════════════════════

  private syncSeuilsActuelles(): void {
    this.seuilsList = this.seuilsList.map(s => ({ ...s, valeurActuelle: this.getEnergieTotal(s.energieId) }));
    this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
  }

  private initSeuilsFromEnergies(): void {
    if (!this.energies.length) return;
    if (this.seuilsList.length === 0) {
      this.seuilsList = this.energies.map((e, i) => ({
        id: i + 1, energieId: Number(e.idEnergie), nom: e.nom,
        periode: 'Mensuel', annee: new Date().getFullYear(),
        valeurCible: 0, valeurActuelle: this.getEnergieTotal(Number(e.idEnergie)), unite: e.unite,
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
    this.editingSeuil = seuil ?? null; this.seuilSaved = false;
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
      else this.seuilsList = [...this.seuilsList, newSeuil];
    }
    this.seuilsHistorique = this.seuilsList.filter(s => s.valeurCible > 0);
    setTimeout(() => {
      this.seuilSaving = false; this.seuilSaved = true; this.editingSeuil = null;
      this.showToast('Seuil enregistré !', 'success');
      setTimeout(() => { this.seuilSaved = false; this.showSeuilModal = false; }, 1400);
    }, 500);
  }

  exportSeuilsCSV(): void {
    const rows: (string | number)[][] = [
      ['Énergie', 'Période', 'Année', 'Seuil cible', 'Unité', 'Consommation actuelle', 'Unité', '%', 'Statut'],
      ...this.seuilsHistorique.map(s => {
        const pct = this.getSeuilPct(s);
        return [s.nom, s.periode, s.annee, s.valeurCible, s.unite, s.valeurActuelle, s.unite, pct, pct <= 80 ? 'OK' : pct <= 100 ? 'Attention' : 'Dépassé'];
      }),
    ];
    this.exportXlsx([{ name: 'Seuils', rows }], `seuils_wicmic_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Export seuils téléchargé.', 'success');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Modal Mesure
  // ══════════════════════════════════════════════════════════════════════════

  openAddMesure(): void {
    this.mesureForm.reset({ sourceDonnee: 'Saisie manuelle', dateMesure: new Date().toISOString().slice(0, 16) });
    this.mesureSaved = false; this.showMesureModal = true;
  }
  resetMesureForm(): void { this.mesureForm.reset({ sourceDonnee: 'Saisie manuelle', dateMesure: new Date().toISOString().slice(0, 16) }); }

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
    const a: AlerteExt = { idAlerte: Date.now(), type: v.type, severite: v.severite, message: v.message, seuil: +(v.seuil) || 0, traite: false, dateCreation: new Date().toISOString(), sourceAuto: false };
    setTimeout(() => {
      this.alertes = [a, ...this.alertes]; this.alerteSaving = false; this.alerteSaved = true;
      this.showToast('Alerte créée !', 'success');
      setTimeout(() => { this.alerteSaved = false; this.showAlerteModal = false; }, 1400);
    }, 500);
  }

  showDeleteConfirmAlerte(a: AlerteExt): void { this.pendingDeleteIds.add(a.idAlerte); }
  cancelDeleteAlerte(a: AlerteExt): void { this.pendingDeleteIds.delete(a.idAlerte); }
  isDeletePendingAlerte(a: AlerteExt): boolean { return this.pendingDeleteIds.has(a.idAlerte); }

  deleteAlerte(a: AlerteExt): void {
    this.pendingDeleteIds.delete(a.idAlerte);
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
        idAlerte: Date.now() + Math.random(), type: 'Dépassement seuil',
        severite: this.getSeuilPct(s) > 130 ? 'Critique' : 'Haute',
        message: `Seuil ${s.nom} dépassé : ${s.valeurActuelle} ${s.unite} / ${s.valeurCible} ${s.unite} (${this.getSeuilPct(s)}%)`,
        seuil: s.valeurCible, traite: false, dateCreation: new Date().toISOString(), sourceAuto: true,
      };
      this.alertes = [alerte, ...this.alertes]; count++;
    });
    this.alertesAutoGenerees = count;
    if (count > 0) this.showToast(`${count} alerte(s) automatique(s) générée(s).`, 'warn');
    else this.showToast('Aucun nouveau seuil dépassé.', 'info');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Modal Anomalie
  // ══════════════════════════════════════════════════════════════════════════

  openAnomalieModal(): void {
    this.anomalieForm.reset({ type: 'Pic de consommation', dateDetection: new Date().toISOString().slice(0, 10) });
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

  get totalMesures()           { return this.mesures.length; }
  get alertesNonTraitees()     { return this.alertes.filter(a => !a.traite).length; }
  get anomaliesNonResolues()   { return this.anomalies.filter(a => !a.resolu).length; }
  get totalRecommandations()   { return this.recommandations.length; }
  get recoAppliquees()         { return this.recommandations.filter(r => r.applique).length; }
  get recoHautePriorite()      { return this.recommandations.filter(r => r.priorite === 'Haute').length; }
  get equipementsActifs()      { return this.equipements.filter(e => !e.statut || e.statut === 'Actif').length; }
  get equipementsMaintenance() { return this.equipements.filter(e => e.statut === 'Maintenance').length; }
  get equipementsInactifs()    { return this.equipements.filter(e => e.statut === 'Inactif').length; }
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
    score += Math.min(10, this.recoAppliquees * 2);
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
    const pts = spark.points; const maxV = Math.max(...pts, 1);
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
    if (!pts.length) return '';
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
    const sumX  = jours90.reduce((s, p) => s + p.x, 0);
    const sumY  = jours90.reduce((s, p) => s + p.y, 0);
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
    this.equipementForm.reset({ statut: 'Actif', dateInstallation: new Date().toISOString().slice(0, 10) });
    this.equipementSaved = false; this.showEquipementModal = true;
  }

  openEditEquipement(e: Equipement): void {
    this.editingEquipement = e;
    const dateRef = e.dateMiseEnService || e.dateInstallation;
    this.equipementForm.patchValue({
      nom: e.nom, typeEquipement: e.typeEquipement, statut: e.statut || 'Actif',
      puissance: e.puissance ?? '', localisation: e.localisation || e.zone?.nom || '',
      dateInstallation: dateRef ? new Date(dateRef).toISOString().slice(0, 10) : '',
      energieId: e.energieId ?? '', zoneId: e.zoneId ?? '',
      description: (e as {description?: string}).description || '',
    });
    this.equipementSaved = false; this.showEquipementModal = true;
  }

  saveEquipement(): void {
    if (this.equipementForm.invalid) { this.equipementForm.markAllAsTouched(); return; }
    this.equipementSaving = true;
    const v = this.equipementForm.value;
    const dto = {
      idEquipement: this.editingEquipement?.idEquipement ?? 0,
      nom: v.nom, typeEquipement: v.typeEquipement, statut: v.statut,
      puissance: v.puissance ? +v.puissance : null, localisation: v.localisation,
      dateMiseEnService: v.dateInstallation ? new Date(v.dateInstallation).toISOString() : null,
      dateInstallation:  v.dateInstallation ? new Date(v.dateInstallation).toISOString() : null,
      energieId: v.energieId ? +v.energieId : null, zoneId: v.zoneId ? +v.zoneId : null,
      description: v.description ?? '', zone: null, energie: null, mesures: [], alertes: [],
    };
    const obs$ = this.editingEquipement
      ? this.api.updateEquipement(this.editingEquipement.idEquipement, dto)
      : this.api.createEquipement(dto);
    obs$.subscribe({
      next: () => {
        this.equipementSaving = false; this.equipementSaved = true;
        this.showToast(this.editingEquipement ? 'Équipement modifié !' : 'Équipement ajouté !', 'success');
        setTimeout(() => { this.equipementSaved = false; this.showEquipementModal = false; this.editingEquipement = null; this.loadAll(); }, 1400);
      },
      error: (err: any) => {
        this.equipementSaving = false;
        this.showToast(err?.error?.message ?? err?.message ?? 'Erreur lors de la sauvegarde.', 'error');
      },
    });
  }

  showDeleteConfirmEquipement(e: Equipement): void { this.pendingDeleteIds.add(e.idEquipement); }
  cancelDeleteEquipement(e: Equipement): void { this.pendingDeleteIds.delete(e.idEquipement); }
  isDeletePendingEquipement(e: Equipement): boolean { return this.pendingDeleteIds.has(e.idEquipement); }

  confirmDeleteEquipement(e: Equipement): void {
    this.equipementToDelete = e;
    this.showDeleteConfirm = true;
  }

  deleteEquipement(e?: Equipement): void {
    const target = e ?? this.equipementToDelete;
    if (!target) return;
    this.pendingDeleteIds.delete(target.idEquipement);
    this.api.deleteEquipement(target.idEquipement).subscribe({
      next:  () => { this.showToast('Équipement supprimé.', 'info'); this.loadAll(); },
      error: () => { this.showToast('Erreur lors de la suppression.', 'error'); },
    });
    this.showDeleteConfirm = false;
    this.equipementToDelete = null;
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

  get alertTypes():       string[] { return [...new Set(this.alertes.map(a => a.type))]; }
  get alertesCritiques(): number   { return this.alertes.filter(a => !a.traite && a.severite === 'Critique').length; }
  get alertesHautes():    number   { return this.alertes.filter(a => !a.traite && a.severite === 'Haute').length; }

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
  // Anomalies (manuelles)
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
      case 'mensuel':     this.exportRapportExcel();      break;
      case 'trimestriel': this.exportRapportTrimestriel(); break;
      case 'seuils':      this.exportRapportSeuils();      break;
      case 'alertes':     this.exportAlertesExcel();       break;
      case 'anomalies':   this.exportRapportAnomalies();   break;
      case 'csv':         this.exportCSV();                break;
    }
  }

  get trimestre(): number { return Math.ceil((new Date().getMonth() + 1) / 3); }

  private exportRapportTrimestriel(): void {
    const rows: (string | number)[][] = [
      [`RAPPORT TRIMESTRIEL — T${this.trimestre} ${new Date().getFullYear()}`, ''],
      ['Généré le', new Date().toLocaleString('fr-FR')],
      ['Nombre de mesures', this.totalMesures],
      ['Alertes', this.alertes.length],
      ['Anomalies', this.anomalies.length],
      ['Coût estimé (DT)', this.coutTotal],
    ];
    this.exportXlsx([{ name: `Rapport T${this.trimestre}`, rows }], `rapport_trim_T${this.trimestre}_${new Date().getFullYear()}.xlsx`);
    this.showToast('Rapport trimestriel téléchargé.', 'success');
  }

  private exportRapportSeuils(): void {
    const rows: (string | number)[][] = [
      ['RAPPORT SEUILS', ''],
      ['Taux de respect (%)', this.tauxSeuil],
      [],
      ['Énergie', 'Consommation', 'Seuil cible', 'Unité', '%', 'Statut'],
      ...this.seuilsList.map(s => {
        const pct = this.getSeuilPct(s);
        return [s.nom, s.valeurActuelle, s.valeurCible, s.unite, pct, pct <= 80 ? 'OK' : pct <= 100 ? 'Proche' : 'Dépassé'];
      }),
    ];
    this.exportXlsx([{ name: 'Seuils', rows }], `rapport_seuils_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Rapport seuils téléchargé.', 'success');
  }

  private exportRapportAnomalies(): void {
    const rows: (string | number)[][] = [
      ['ID', 'Type', 'Description', 'Date', 'Énergie', 'Statut', 'Progression (%)'],
      ...this.anomalies.map(a => [
        a.id, a.type ?? 'Anomalie', a.description,
        new Date(a.dateDetection).toLocaleDateString('fr-FR'),
        a.energieNom ?? '—', a.resolu ? 'Résolue' : 'En cours', this.getProgress(a),
      ]),
    ];
    this.exportXlsx([{ name: 'Anomalies', rows }], `rapport_anomalies_${new Date().toISOString().slice(0, 10)}.xlsx`);
    this.showToast('Rapport anomalies téléchargé.', 'success');
  }

  exportCSV(): void {
    const headers = ['ID', 'Valeur', 'Unité', 'Source', 'Énergie', 'Équipement', 'Date mesure', 'Statut'];
    const rows = this.mesures.map(m => [
      m.idMesure, m.valeur, this.getEnergieUnite(m.energieId), m.sourceDonnee,
      this.getEnergieNom(m.energieId), m.equipement?.nom || '—',
      new Date(m.dateMesure).toLocaleString('fr-FR'),
      this.isAboveThreshold(m.valeur) ? 'Dépassement' : 'Normal',
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `mesures_wicmic_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    this.showToast('Export CSV téléchargé.', 'success');
  }

  exportRapport(): void {
    const sep = '═'.repeat(60); const sub = '─'.repeat(60);
    const lines = [
      'WICMIC ENERGY — Rapport de consommation', sep,
      `Généré le : ${new Date().toLocaleString('fr-FR')}`,
      `Utilisateur : ${this.currentUser?.nom ?? '—'}`,
      `Période : ${this.dateRangeLabel}`, sub,
      `Total mesures : ${this.mesuresFiltreesParDate.length}`,
      `Moyenne : ${this.moyenneMesuresFiltrees}`,
      `Max : ${this.maxMesureFiltre}`,
      `Min : ${this.minMesureFiltre}`,
      `Coût période : ${this.coutPeriodeFiltree} DT`,
      `Coût ce mois : ${this.coutMoisCourant} DT`,
      `Coût total : ${this.coutTotal} DT`,
      `Tendance : ${this.tendance} (${this.tendancePct}%)`, sub,
      `Alertes actives : ${this.alertesNonTraitees} (${this.alertesCritiques} critiques)`,
      `Anomalies : ${this.anomaliesNonResolues} non résolues / ${this.anomalies.length}`,
      `Recommandations : ${this.recoAppliquees}/${this.totalRecommandations} appliquées`, sub,
      '── ÉNERGIES ──',
      ...this.energies.map(en => `${en.nom.padEnd(20)}: ${this.getEnergieTotal(en.idEnergie)} ${en.unite} — ${this.getEnergieCout(en.idEnergie)} DT (${this.getEnergiePct(en.idEnergie)}%)`),
      sub,
    ];
    this.download(lines.join('\n'), `rapport_wicmic_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
    this.showToast('Rapport exporté.', 'success');
  }

  exportRapportPDF(): void {
    const sep = '═'.repeat(72); const sub = '─'.repeat(72);
    const date = new Date().toLocaleString('fr-FR');
    const lines = [
      '╔' + '═'.repeat(70) + '╗',
      '║' + '         WICMIC ENERGY — RAPPORT EXÉCUTIF COMPLET'.padEnd(70) + '║',
      '║' + `         Généré le : ${date}`.padEnd(70) + '║',
      '║' + `         ${this.totalMesures} mesures · Score efficacité : ${this.efficiencyScore}/100 (${this.efficiencyGrade})`.padEnd(70) + '║',
      '╚' + '═'.repeat(70) + '╝', '',
      sep, '  SECTION 1 — TABLEAU DE BORD', sub,
      `  Score efficacité : ${this.efficiencyScore}/100 (${this.efficiencyGrade})`,
      `  Coût ce mois : ${this.coutMoisCourant} DT`,
      `  Coût total : ${this.coutTotal} DT`,
      `  Tendance : ${this.tendance === 'up' ? '↑ HAUSSE' : this.tendance === 'down' ? '↓ BAISSE' : '→ STABLE'} (${this.tendancePct}%)`, '',
      sep, '  SECTION 2 — CONSOMMATIONS PAR VECTEUR', sub,
      ...this.energies.map(en => `  ${en.nom.padEnd(20)}: ${this.getEnergieTotal(en.idEnergie).toString().padStart(8)} ${en.unite.padEnd(6)} | ${this.getEnergieCout(en.idEnergie)} DT | ${this.getEnergiePct(en.idEnergie)}%`), '',
      sep, '  SECTION 3 — SEUILS', sub,
      `  Taux de respect : ${this.seuilsDefinis > 0 ? this.tauxSeuil + '%' : 'Aucun seuil défini'}`,
      ...this.seuilsList.map(s => s.valeurCible === 0
        ? `  ${s.nom.padEnd(20)}: Non défini`
        : `  ${s.nom.padEnd(20)}: ${s.valeurActuelle}/${s.valeurCible} ${s.unite} | ${this.getSeuilPct(s)}% | ${this.getSeuilPct(s) <= 80 ? '✓ OK' : this.getSeuilPct(s) <= 100 ? '⚠ Proche' : '✕ DÉPASSÉ'}`
      ), '',
      sep, '  SECTION 4 — ALERTES & ANOMALIES', sub,
      `  Alertes actives : ${this.alertesNonTraitees} (${this.alertesCritiques} critique(s))`,
      `  Anomalies en cours : ${this.anomaliesNonResolues}/${this.anomalies.length}`,
      `  Recommandations appliquées : ${this.recoAppliquees}/${this.totalRecommandations}`, '',
      sep, `  Utilisateur : ${this.currentUser?.nom ?? '—'}`, sep,
    ];
    this.download(lines.join('\n'), `rapport_executif_wicmic_${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
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

    const dashboardCtx = [
      'Contexte WICMIC Energy :',
      `- Mesures : ${this.totalMesures} | Moy : ${this.moyenneMesures} | Max : ${this.maxMesure}`,
      `- Coût mois : ${this.coutMoisCourant} DT | Total : ${this.coutTotal} DT`,
      `- Alertes actives : ${this.alertesNonTraitees} (${this.alertesCritiques} critiques)`,
      `- Anomalies : ${this.anomaliesNonResolues}/${this.anomalies.length}`,
      `- Équipements : ${this.equipementsActifs} actifs / ${this.equipements.length}`,
      `- Score efficacité : ${this.efficiencyScore}/100 (${this.efficiencyGrade})`,
      `- Tendance : ${this.tendance} (${this.tendancePct}%)`,
      `- Raisonnement IA prévisions : ${this.previsionRaisonnement || 'N/A'}`,
      `- Résumé benchmark IA : ${this.benchmarkIA?.resumeGlobal || 'N/A'}`,
    ].join('\n');

    const social = isSocialMessage(msg);
    const payload = { prompt: msg, context: social ? '' : dashboardCtx };

    this.http.post<{ response: string }>(`${this.RAG_URL}/chat`, payload).pipe(
      timeout(20000),
      catchError(() =>
        this.api.ollamaChat(social ? msg : dashboardCtx + `\n\nQuestion : ${msg}`)
      )
    ).subscribe({
      next: res => {
        this.messages.push({ role: 'assistant', content: res.response, time: new Date() });
        this.chatLoading = false; this._scrollChat();
      },
      error: () => {
        const errMsg = 'Service IA indisponible (délai dépassé). Vérifiez que FastAPI et Ollama tournent sur le port 8000.';
        this.messages.push({ role: 'assistant', content: errMsg, time: new Date() });
        this.chatLoading = false; this._scrollChat();
      },
    });
  }

  sendSuggestion(text: string): void { this.chatInput = text; this.sendChat(); }
  onChatEnter(event: Event): void { const ke = event as KeyboardEvent; if (!ke.shiftKey) { event.preventDefault(); this.sendChat(); } }
  private _scrollChat(): void { setTimeout(() => { if (this.chatScrollRef?.nativeElement) this.chatScrollRef.nativeElement.scrollTop = this.chatScrollRef.nativeElement.scrollHeight; }, 50); }

  // ══════════════════════════════════════════════════════════════════════════
  // Benchmarking
  // ══════════════════════════════════════════════════════════════════════════

  private initBenchmarking(): void {
    const now = new Date();
    const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const monthlyTotals: { label: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const fin = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const t   = this.mesures.filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; }).reduce((s, m) => s + m.valeur, 0);
      monthlyTotals.push({ label: moisLabels[d.getMonth()], total: +t.toFixed(1) });
    }
    const nonZero = monthlyTotals.filter(m => m.total > 0);
    const maxM = nonZero.length ? Math.max(...nonZero.map(m => m.total)) : 0;
    const minM = nonZero.length ? Math.min(...nonZero.map(m => m.total)) : 0;
    this.rankTimeline = monthlyTotals.map(m => {
      if (m.total === 0) return { label: m.label, pct: 0 };
      let pct = 50;
      if (maxM > minM) { pct = Math.round(100 - ((m.total - minM) / (maxM - minM)) * 100); pct = Math.max(5, Math.min(95, pct)); }
      return { label: m.label, pct };
    });

    const getMonthTotal = (eid: number, offset: number): number => {
      const d   = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const fin = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
      return +this.mesures
        .filter(m => Number(m.energieId) === Number(eid))
        .filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; })
        .reduce((s, m) => s + m.valeur, 0).toFixed(1);
    };

    const getMoyenne = (eid: number): number => {
      const vals: number[] = [];
      for (let i = 11; i >= 0; i--) { const v = getMonthTotal(eid, i); if (v > 0) vals.push(v); }
      return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
    };

    const energiesPayload = this.energies.map(en => ({
      nom:           en.nom,
      unite:         en.unite,
      moisActuel:    getMonthTotal(Number(en.idEnergie), 0),
      moisPrecedent: getMonthTotal(Number(en.idEnergie), 1),
      moyenne:       getMoyenne(Number(en.idEnergie)),
    })).filter(e => e.moisActuel > 0 || e.moisPrecedent > 0);

    if (!energiesPayload.length) {
      this.benchmarkData = [{ energie: '— Aucune donnée', unite: '', moisActuel: 0, moisPrecedent: 0, moyenne: 0, variation: 0, position: 'same', insight: 'Aucune donnée ce mois.', hasData: false }];
      return;
    }

    this.benchmarkData = energiesPayload.map(e => {
      const variation = e.moisPrecedent > 0 ? +((e.moisActuel - e.moisPrecedent) / e.moisPrecedent * 100).toFixed(1) : 0;
      const position: 'better'|'same'|'worse' = variation < -3 ? 'better' : variation > 3 ? 'worse' : 'same';
      const en = this.energies.find(en => en.nom === e.nom);
      return {
        energie:  `${this.getEnergieIcon(en ? Number(en.idEnergie) : 0)} ${e.nom}`,
        unite:    e.unite, moisActuel: e.moisActuel, moisPrecedent: e.moisPrecedent,
        moyenne:  e.moyenne, variation, position,
        insight:  '⏳ Analyse IA en cours...', hasData: true,
      };
    });

    this.aiLoadingBench = true;
    this.http.post<{ job_id: string }>(`${this.RAG_URL}/benchmark/start`, { energies: energiesPayload })
      .pipe(timeout(10000), catchError(() => of(null)))
      .subscribe({
        next: res => {
          if (!res?.job_id) {
            this.aiLoadingBench = false;
            this.benchmarkData = this.benchmarkData.map(b => ({
              ...b, insight: b.insight.replace('⏳ Analyse IA en cours...', '⚠️ Service IA indisponible — analyse locale uniquement.'),
            }));
            return;
          }
          this.pollJob<BenchmarkIA>(
            res.job_id,
            `${this.RAG_URL}/benchmark/result/${res.job_id}`,
            (result: BenchmarkIA) => {
              this.benchmarkIA = result;
              if (result.benchmarks?.length) {
                this.benchmarkData = result.benchmarks.map(b => {
                  const en = this.energies.find(e => e.nom === b.energie);
                  return {
                    energie:  `${this.getEnergieIcon(en ? Number(en.idEnergie) : 0)} ${b.energie}`,
                    unite:    b.unite, moisActuel: b.moisActuel, moisPrecedent: b.moisPrecedent,
                    moyenne:  b.moyenne, variation: b.variation, position: b.position,
                    insight:  b.insight, hasData: b.hasData,
                  };
                });
              }
              this.aiLoadingBench = false;
              this.cdr.detectChanges();
            },
            () => {
              this.aiLoadingBench = false;
              this.benchmarkData = this.benchmarkData.map(b => ({
                ...b, insight: b.insight.replace('⏳ Analyse IA en cours...', '⚠️ Service IA indisponible — analyse locale uniquement.'),
              }));
              this.cdr.detectChanges();
            }
          );
        },
        error: () => {
          this.aiLoadingBench = false;
          this.cdr.detectChanges();
        }
      });
  }

  get hasRankTimelineData(): boolean { return this.rankTimeline.some(r => r.pct > 0); }

  // ══════════════════════════════════════════════════════════════════════════
  // Prévisions IA
  // ══════════════════════════════════════════════════════════════════════════

  recalculatePrevisions(): void {
    this.initPrevisions();
    this.showToast('Prévisions IA en cours de calcul...', 'info');
  }

  private initPrevisions(): void {
    const now = new Date();

    const getMonthlyPoints = (eid: number): { mois: string; total: number }[] => {
      const pts: { mois: string; total: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const fin   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const total = this.mesures
          .filter(m => Number(m.energieId) === Number(eid))
          .filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; })
          .reduce((s, m) => s + m.valeur, 0);
        if (total > 0) pts.push({ mois: label, total: +total.toFixed(1) });
      }
      return pts;
    };

    const ptE = this.idElec   ? getMonthlyPoints(this.idElec)   : [];
    const ptW = this.idEau    ? getMonthlyPoints(this.idEau)    : [];
    const ptG = this.idGazoil ? getMonthlyPoints(this.idGazoil) : [];

    const MIN = 2;
    if (ptE.length < MIN && ptW.length < MIN && ptG.length < MIN) {
      this.previsionMoisProchain = { elec: 0, eau: 0, gazoil: 0, fiabilite: 0, elecTrend: 'flat', elecVar: '0', hasEnoughData: false };
      this.previsionRecos = [{ titre: 'Données insuffisantes', description: `Minimum ${MIN} mois de données requis pour les prévisions IA.`, economie: 0, urgence: 'normale' }];
      this.forecastPoints = [];
      return;
    }

    this.aiLoading = true;
    this.previsionMoisProchain = { ...this.previsionMoisProchain, hasEnoughData: true };

    const payload = {
      energies: [
        { nom: NOM_ELECTRICITE, unite: this.getEnergieUnite(this.idElec),   mois: ptE },
        { nom: NOM_EAU,         unite: this.getEnergieUnite(this.idEau),    mois: ptW },
        { nom: NOM_GAZOIL,      unite: this.getEnergieUnite(this.idGazoil), mois: ptG },
      ].filter(e => e.mois.length >= MIN),
    };

    this.http.post<{ job_id: string }>(`${this.RAG_URL}/previsions/start`, payload)
      .pipe(timeout(10000), catchError(() => of(null)))
      .subscribe({
        next: res => {
          if (!res?.job_id) {
            this._fallbackPrevisions(ptE, ptW, ptG);
            return;
          }
          this.pollJob<PrevisionIA>(
            res.job_id,
            `${this.RAG_URL}/previsions/result/${res.job_id}`,
            (result: PrevisionIA) => {
              this.previsionMoisProchain = {
                elec:          result.elec          ?? 0,
                eau:           result.eau           ?? 0,
                gazoil:        result.gazoil        ?? 0,
                fiabilite:     result.fiabilite     ?? 0,
                elecTrend:     result.elecTrend     ?? 'flat',
                elecVar:       result.elecVar       ?? '0',
                hasEnoughData: result.hasEnoughData ?? true,
              };
              this.previsionRaisonnement = result.raisonnement ?? '';
              this.previsionRecos = (result.recos ?? []).map(r => ({
                titre: r.titre, description: r.description, economie: r.economie, urgence: r.urgence,
              }));
              this.aiLoading = false;
              this.buildForecastPoints();
              this.showToast('✅ Prévisions IA générées !', 'success');
              this.cdr.detectChanges();
            },
            () => this._fallbackPrevisions(ptE, ptW, ptG)
          );
        },
        error: () => this._fallbackPrevisions(ptE, ptW, ptG)
      });
  }

  private _fallbackPrevisions(
    ptE: { mois: string; total: number }[],
    ptW: { mois: string; total: number }[],
    ptG: { mois: string; total: number }[]
  ): void {
    this.showToast('⚠️ FastAPI indisponible — prévisions calculées localement.', 'warn');

    const regressionLineaire = (points: { mois: string; total: number }[]): number => {
      if (!points.length) return 0;
      const n = points.length;
      const xs = points.map((_, i) => i + 1);
      const ys = points.map(p => p.total);
      const sumX  = xs.reduce((a, b) => a + b, 0);
      const sumY  = ys.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const denom = n * sumX2 - sumX * sumX;
      if (!denom) return +(sumY / n).toFixed(1);
      const a = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - a * sumX) / n;
      return Math.max(0, +((a * (n + 1) + b)).toFixed(1));
    };

    const calcFiabilite = (points: { mois: string; total: number }[]): number => {
      if (points.length < 3) return 50;
      const vals = points.map(p => p.total);
      const moy = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - moy) ** 2, 0) / vals.length;
      const cv = moy > 0 ? Math.sqrt(variance) / moy : 1;
      return Math.max(30, Math.min(85, Math.round((1 - cv) * 100)));
    };

    const elecVal   = regressionLineaire(ptE);
    const eauVal    = regressionLineaire(ptW);
    const gazoilVal = regressionLineaire(ptG);
    const fiabilite = Math.round((calcFiabilite(ptE) + calcFiabilite(ptW) + calcFiabilite(ptG)) / 3);

    const dernierElec = ptE.length ? ptE[ptE.length - 1].total : 0;
    const elecVar = dernierElec > 0
      ? Math.abs(((elecVal - dernierElec) / dernierElec) * 100).toFixed(1)
      : '0';
    const elecTrend: 'up'|'down'|'flat' = elecVal > dernierElec * 1.03
      ? 'up' : elecVal < dernierElec * 0.97 ? 'down' : 'flat';

    this.previsionMoisProchain = {
      elec: elecVal, eau: eauVal, gazoil: gazoilVal,
      fiabilite, elecTrend, elecVar, hasEnoughData: true,
    };
    this.previsionRaisonnement = 'Calcul local par régression linéaire (FastAPI indisponible).';
    this.previsionRecos = [{
      titre: 'Service IA externe indisponible',
      description: 'Les prévisions affichées sont calculées localement par régression linéaire. Démarrez FastAPI sur le port 8000 pour des prévisions IA enrichies.',
      economie: 0, urgence: 'normale',
    }];
    this.aiLoading = false;
    this.buildForecastPoints();
    this.cdr.detectChanges();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Détection Anomalies IA 
  // ══════════════════════════════════════════════════════════════════════════

  lancerDetectionAnomalies(): void {
    if (!this.mesures.length || !this.energies.length) {
      console.warn('[AnomaliesIA] Données non prêtes — analyse annulée.');
      return;
    }
    if (this.aiLoadingAnomalies) return;
    this.aiLoadingAnomalies = true;
    this.anomaliesIA = null;

    this.http.post<{ job_id: string }>(`${this.RAG_URL}/anomalies/start`, {})
      .pipe(timeout(8000), catchError(() => of(null)))
      .subscribe({
        next: res => {
          if (!res?.job_id) {
            this.anomaliesIA = this.calculerAnomaliesLocales();
            this.aiLoadingAnomalies = false;
            this.cdr.detectChanges();
            return;
          }
          this.pollJob<AnomaliesIAResult>(
            res.job_id,
            `${this.RAG_URL}/anomalies/result/${res.job_id}`,
            (result: AnomaliesIAResult) => {
              // Vérifier que le résultat est complet
              if (result && result.resume && result.resume.length > 10) {
                this.anomaliesIA = result;
              } else {
                this.anomaliesIA = this.calculerAnomaliesLocales();
              }
              this.aiLoadingAnomalies = false;
              this.showToast('✅ Anomalies IA détectées !', 'success');
              this.cdr.detectChanges();
            },
            () => {
              this.anomaliesIA = this.calculerAnomaliesLocales();
              this.aiLoadingAnomalies = false;
              this.cdr.detectChanges();
            }
          );
        },
        error: () => {
          this.anomaliesIA = this.calculerAnomaliesLocales();
          this.aiLoadingAnomalies = false;
          this.cdr.detectChanges();
        }
      });
  }

  // Seuils : Z-score 2.0, IQR 1.5 — résumé TOUJOURS rempli
  private calculerAnomaliesLocales(): AnomaliesIAResult {
    const anomalies: AnomalieIA[] = [];

    for (const en of this.energies) {
      const mesuresEn = this.mesures
        .filter(m => Number(m.energieId) === Number(en.idEnergie))
        .map(m => ({ valeur: m.valeur, date: m.dateMesure }));

      if (mesuresEn.length < 3) continue;

      const valeurs = mesuresEn.map(m => m.valeur);
      const n       = valeurs.length;
      const moy     = valeurs.reduce((s, v) => s + v, 0) / n;
      const ecartType = Math.sqrt(valeurs.reduce((s, v) => s + (v - moy) ** 2, 0) / n);

      const sorted = [...valeurs].sort((a, b) => a - b);
      const q1  = sorted[Math.floor(n * 0.25)];
      const q3  = sorted[Math.floor(n * 0.75)];
      const iqr = q3 - q1;

      for (const m of mesuresEn) {
        const zscore = ecartType > 0 ? Math.abs((m.valeur - moy) / ecartType) : 0;
        const isIQR  = iqr > 0 && (m.valeur < q1 - 1.5 * iqr || m.valeur > q3 + 1.5 * iqr);
        const isZ    = zscore > 2.0;

        if (!isIQR && !isZ) continue;

        const ecart_pct = moy > 0 ? Math.round(((m.valeur - moy) / moy) * 100) : 0;

        let severite = 'normale';
        if (zscore > 3.0 || Math.abs(ecart_pct) > 80) severite = 'critique';
        else if (zscore > 2.0 || Math.abs(ecart_pct) > 30) severite = 'haute';

        anomalies.push({
          severite,
          energie:   en.nom,
          unite:     en.unite,
          date:      new Date(m.date).toLocaleDateString('fr-FR'),
          valeur:    +m.valeur.toFixed(2),
          moyenne:   +moy.toFixed(2),
          ecart_pct,
          type:      m.valeur > moy ? 'Surconsommation' : 'Sous-consommation',
          methode:   isZ && isIQR ? 'Z-score + IQR' : isZ ? 'Z-score' : 'IQR',
        });
      }
    }

    anomalies.sort((a, b) => {
      const order = { critique: 0, haute: 1, normale: 2 };
      return (order[a.severite as keyof typeof order] ?? 2) - (order[b.severite as keyof typeof order] ?? 2);
    });

    const nb_critiques = anomalies.filter(a => a.severite === 'critique').length;
    const nb_hautes    = anomalies.filter(a => a.severite === 'haute').length;
    const nb_normales  = anomalies.filter(a => a.severite === 'normale').length;

    let score_sante = 100 - nb_critiques * 15 - nb_hautes * 8 - nb_normales * 3;
    score_sante = Math.max(0, Math.min(100, Math.round(score_sante)));

    // Résumé TOUJOURS rempli
    let resume: string;
    if (!anomalies.length) {
      resume = `Aucune anomalie détectée sur ${this.mesures.length} mesures analysées `
             + `(${this.energies.length} vecteurs énergétiques). `
             + `Score de santé énergétique : ${score_sante}/100. `
             + `Toutes les consommations sont dans les normes habituelles.`;
    } else {
      resume = `${anomalies.length} anomalie(s) détectée(s) sur ${this.mesures.length} mesures analysées. `
             + `Score de santé : ${score_sante}/100. `
             + `${nb_critiques} critique(s), ${nb_hautes} haute(s), ${nb_normales} normale(s). `;
      if (nb_critiques > 0) {
        const critEnergies = [...new Set(anomalies.filter(a => a.severite === 'critique').map(a => a.energie))];
        resume += `Intervention prioritaire requise sur : ${critEnergies.join(', ')}.`;
      } else {
        resume += `Surveillance renforcée recommandée.`;
      }
    }

    return { score_sante, resume, nb_critiques, nb_hautes, nb_normales, anomalies };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Recommandations IA — VERSION CORRIGÉE
  // Résumé et économies TOUJOURS remplis
  // ══════════════════════════════════════════════════════════════════════════

  lancerRecommandations(): void {
    if (this.aiLoadingRecos) return;
    this.aiLoadingRecos = true;
    this.recommandationsIA = null;

    this.http.post<{ job_id: string }>(`${this.RAG_URL}/recommandations/start`, {})
      .pipe(timeout(8000), catchError(() => of(null)))
      .subscribe({
        next: res => {
          if (!res?.job_id) {
            this.recommandationsIA = this.genererRecommandationsLocales();
            this.aiLoadingRecos = false;
            this.cdr.detectChanges();
            return;
          }
          this.pollJob<RecommandationsIAResult>(
            res.job_id,
            `${this.RAG_URL}/recommandations/result/${res.job_id}`,
            (result: RecommandationsIAResult) => {
              // Vérifier que le résultat est complet
              if (result && result.recommandations?.length > 0 && result.resume?.length > 10) {
                this.recommandationsIA = result;
              } else {
                this.recommandationsIA = this.genererRecommandationsLocales();
              }
              this.aiLoadingRecos = false;
              this.showToast('✅ Recommandations IA générées !', 'success');
              this.cdr.detectChanges();
            },
            () => {
              this.recommandationsIA = this.genererRecommandationsLocales();
              this.aiLoadingRecos = false;
              this.cdr.detectChanges();
            }
          );
        },
        error: () => {
          this.recommandationsIA = this.genererRecommandationsLocales();
          this.aiLoadingRecos = false;
          this.cdr.detectChanges();
        }
      });
  }

  private genererRecommandationsLocales(): RecommandationsIAResult {
    const recos: RecommandationIA[] = [];

    const getTarif = (nom: string): number => {
      const n = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (n.includes('elec') || n.includes('electr')) return 0.28;
      if (n.includes('eau')  || n.includes('water'))  return 0.85;
      if (n.includes('gazoil') || n.includes('gaz'))  return 2.10;
      return 0.28;
    };

    for (const en of this.energies) {
      const eid   = Number(en.idEnergie);
      const total = this.getEnergieTotal(eid);
      const tarif = getTarif(en.nom);
      const nom   = en.nom;
      const unite = en.unite;

      if (!total) continue;

      const now = new Date();
      const moisAct = this.mesures
        .filter(m => {
          const d = new Date(m.dateMesure);
          return Number(m.energieId) === eid &&
                 d.getMonth() === now.getMonth() &&
                 d.getFullYear() === now.getFullYear();
        })
        .reduce((s, m) => s + m.valeur, 0);

      const moisPrec = this.mesures
        .filter(m => {
          const d = new Date(m.dateMesure);
          const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          return Number(m.energieId) === eid &&
                 d.getMonth() === prev.getMonth() &&
                 d.getFullYear() === prev.getFullYear();
        })
        .reduce((s, m) => s + m.valeur, 0);

      const variation = moisPrec > 0
        ? +((moisAct - moisPrec) / moisPrec * 100).toFixed(1)
        : 0;

      if (variation > 5) {
        recos.push({
          titre:            `Réduire la consommation ${nom}`,
          description:      `La consommation ${nom} augmente de ${variation > 0 ? '+' : ''}${variation}% ce mois `
                          + `(${moisAct.toFixed(1)} ${unite} vs ${moisPrec.toFixed(1)} ${unite} le mois précédent). `
                          + `Audit des équipements associés et révision des plages horaires recommandés en priorité. `
                          + `Économie potentielle estimée à 12% de la consommation actuelle.`,
          priorite:         'haute',
          economie_estimee: Math.max(1, Math.round(moisAct * 0.12 * tarif)),
          delai:            '1-2 semaines',
          energie_ciblee:   nom,
          categorie:        'équipement',
        });
      } else if (variation < -5) {
        recos.push({
          titre:            `Maintenir la performance ${nom}`,
          description:      `Baisse positive de ${Math.abs(variation)}% sur ${nom} `
                          + `(${moisAct.toFixed(1)} ${unite} vs ${moisPrec.toFixed(1)} ${unite}). `
                          + `Documenter les bonnes pratiques et les reproduire les prochains mois. `
                          + `Cette performance doit être pérennisée et partagée avec les équipes.`,
          priorite:         'moyenne',
          economie_estimee: Math.max(1, Math.round(moisAct * 0.05 * tarif)),
          delai:            '1 mois',
          energie_ciblee:   nom,
          categorie:        'comportement',
        });
      } else if (total > 0) {
        const nom_lower = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let desc = '';
        if (nom_lower.includes('elec') || nom_lower.includes('electr')) {
          desc = `Optimiser la gestion des heures creuses pour l'électricité (${total.toFixed(1)} ${unite} total). `
               + `Décaler les opérations énergivores vers 22h-6h peut générer jusqu'à 25% d'économies. `
               + `Installer des minuteries et détecteurs de présence sur l'éclairage.`;
        } else if (nom_lower.includes('eau') || nom_lower.includes('water')) {
          desc = `Audit hydraulique recommandé pour ${nom} (${total.toFixed(1)} ${unite} total). `
               + `Vérifier les circuits pour détecter les fuites potentielles. `
               + `Mettre en place un système de recyclage de l'eau pour les processus industriels.`;
        } else if (nom_lower.includes('gazoil') || nom_lower.includes('gaz')) {
          desc = `Optimiser les cycles de chauffe pour ${nom} (${total.toFixed(1)} ${unite} total). `
               + `Un ajustement des consignes de température de 5°C génère 10-15% d'économies. `
               + `Vérifier l'isolation thermique des équipements de chauffage.`;
        } else {
          desc = `Surveiller et optimiser la consommation de ${nom} (${total.toFixed(1)} ${unite} total). `
               + `Mettre en place des relevés hebdomadaires pour identifier les dérives. `
               + `Définir des seuils d'alerte adaptés à ce vecteur énergétique.`;
        }
        recos.push({
          titre:            `Optimiser ${nom}`,
          description:      desc,
          priorite:         'faible',
          economie_estimee: Math.max(1, Math.round(total * 0.05 * tarif)),
          delai:            '1-3 mois',
          energie_ciblee:   nom,
          categorie:        'process',
        });
      }
    }

    if (this.alertesCritiques > 0) {
      recos.push({
        titre:            'Traiter les alertes critiques en priorité absolue',
        description:      `${this.alertesCritiques} alerte(s) critique(s) active(s) nécessitent une intervention immédiate. `
                        + `Chaque alerte non traitée peut engendrer des surconsommations prolongées et des surcoûts importants. `
                        + `Accéder à l'onglet Alertes pour consulter le détail et prendre les mesures correctives.`,
        priorite:         'haute',
        economie_estimee: Math.max(1, Math.round(this.coutMoisCourant * 0.08)),
        delai:            'Immédiat',
        energie_ciblee:   'Toutes énergies',
        categorie:        'maintenance',
      });
    }

    if (this.equipementsMaintenance > 0) {
      recos.push({
        titre:            'Finaliser les maintenances en cours',
        description:      `${this.equipementsMaintenance} équipement(s) en maintenance impactent potentiellement la performance énergétique. `
                        + `Les équipements non optimaux consomment en moyenne 15-20% de plus que les équipements en bon état. `
                        + `Prioriser les réparations et mises à jour pour retrouver un fonctionnement optimal.`,
        priorite:         'moyenne',
        economie_estimee: Math.max(1, Math.round(this.coutTotal * 0.05)),
        delai:            '2-4 semaines',
        energie_ciblee:   'Toutes énergies',
        categorie:        'maintenance',
      });
    }

    // Recommandation transversale toujours présente
    recos.push({
      titre:            'Tableau de bord et alertes automatiques',
      description:      'Configurer des seuils d\'alerte automatiques pour chaque vecteur énergétique '
                      + 'afin de détecter les dérives en temps réel. '
                      + 'Cette mesure permet une réactivité immédiate et évite les surconsommations prolongées. '
                      + 'Mettre en place des notifications quotidiennes pour les responsables énergie.',
      priorite:         'haute',
      economie_estimee: Math.max(1, Math.round(this.coutTotal * 0.03)),
      delai:            'Immédiat',
      energie_ciblee:   'Toutes énergies',
      categorie:        'maintenance',
    });

    recos.sort((a, b) => {
      const order = { haute: 0, moyenne: 1, faible: 2 };
      return (order[a.priorite as keyof typeof order] ?? 2) - (order[b.priorite as keyof typeof order] ?? 2);
    });

    const economie_totale = recos.reduce((s, r) => s + r.economie_estimee, 0);
    const nb_haute        = recos.filter(r => r.priorite === 'haute').length;

    // Résumé TOUJOURS rempli et détaillé
    const now = new Date();
    const tendancesUp = this.energies.filter(en => {
      const eid = Number(en.idEnergie);
      const act  = this.mesures.filter(m => {
        const d = new Date(m.dateMesure);
        return Number(m.energieId) === eid && d.getMonth() === now.getMonth();
      }).reduce((s, m) => s + m.valeur, 0);
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prec = this.mesures.filter(m => {
        const d = new Date(m.dateMesure);
        return Number(m.energieId) === eid && d.getMonth() === prev.getMonth();
      }).reduce((s, m) => s + m.valeur, 0);
      return prec > 0 && ((act - prec) / prec * 100) > 5;
    }).map(en => en.nom);

    let resume = `${recos.length} recommandation(s) générée(s) basées sur l'analyse des données réelles. `;

    if (tendancesUp.length > 0) {
      resume += `Actions prioritaires requises sur : ${tendancesUp.join(', ')} (tendance à la hausse). `;
    }

    resume += `Économies potentielles estimées : ${economie_totale} DT/mois. `;
    resume += `${nb_haute} action(s) prioritaire(s) à mettre en œuvre immédiatement.`;

    return { resume, economie_totale, nb_haute, recommandations: recos };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rapport IA — VERSION CORRIGÉE
  // Résumé exécutif TOUJOURS rempli
  // ══════════════════════════════════════════════════════════════════════════

  genererRapportIA(): void {
    if (this.aiLoadingRapport) return;
    this.aiLoadingRapport = true;
    this.rapportIA = null;

    const statsEnergies: Record<string, StatEnergie> = {};
    for (const en of this.energies) {
      const eid           = Number(en.idEnergie);
      const moisActuel    = this.getMoisTotal(eid, 0);
      const moisPrecedent = this.getMoisTotal(eid, 1);
      const variation_pct = moisPrecedent > 0
        ? +((moisActuel - moisPrecedent) / moisPrecedent * 100).toFixed(1)
        : 0;
      const prevision = moisActuel > 0
        ? Math.round(moisActuel * (1 + Math.min(variation_pct, 30) / 100 * 0.5))
        : 0;
      const tendance: 'up'|'down'|'flat' = variation_pct > 3 ? 'up' : variation_pct < -3 ? 'down' : 'flat';
      statsEnergies[en.nom] = {
        mois_actuel: moisActuel, mois_precedent: moisPrecedent,
        variation_pct, moyenne: +this.getEnergieTotal(eid).toFixed(1),
        prevision, tendance, r2: 0.7, unite: en.unite,
      };
    }

    const anomaliesTop3 = this.anomaliesIA?.anomalies
      ?.filter(a => a.severite === 'critique').slice(0, 3)
      .map(a => ({
        energie:     a.energie,
        date:        a.date,
        description: `${a.type} — Valeur : ${a.valeur} ${a.unite} (écart : ${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}% vs moyenne)`,
        ecart_pct:   a.ecart_pct,
      })) ?? [];

    // Compléter avec des anomalies benchmark si nécessaire
    if (anomaliesTop3.length === 0) {
      for (const [nom, stats] of Object.entries(statsEnergies)) {
        if (Math.abs(stats.variation_pct) > 20) {
          anomaliesTop3.push({
            energie:     nom,
            date:        new Date().toLocaleDateString('fr-FR'),
            description: `${stats.variation_pct > 0 ? 'Hausse' : 'Baisse'} de ${Math.abs(stats.variation_pct)}% — `
                       + `${stats.mois_actuel} vs ${stats.mois_precedent} ${stats.unite}`,
            ecart_pct:   stats.variation_pct,
          });
        }
      }
    }

    const nb_anomalies = Math.max(
      anomaliesTop3.length,
      (this.anomaliesIA?.anomalies?.length ?? 0) + this.anomalies.filter(a => !a.resolu).length
    );

    const now = new Date();

    this.http.post<{ job_id: string }>(`${this.RAG_URL}/rapport/start`, {})
      .pipe(timeout(8000), catchError(() => of(null)))
      .subscribe({
        next: res => {
          if (!res?.job_id) {
            this.rapportIA = this.construireRapportIALocal(statsEnergies, anomaliesTop3, nb_anomalies, now);
            this.aiLoadingRapport = false;
            this.cdr.detectChanges();
            return;
          }
          this.pollJob<any>(
            res.job_id,
            `${this.RAG_URL}/rapport/result/${res.job_id}`,
            (result: any) => {
              
              const resumeOk = result?.resume_executif && result.resume_executif.length > 30;
              if (resumeOk) {
                this.rapportIA = {
                  date_generation: result.date_generation ?? now.toLocaleDateString('fr-FR'),
                  nb_mesures:      result.nb_mesures ?? this.mesuresFiltreesParDate.length,
                  periode:         result.periode    ?? this.dateRangeLabel,
                  score_sante:     result.score_sante ?? this.efficiencyScore,
                  nb_anomalies,
                  resume_executif: result.resume_executif,
                  points_cles:     result.points_cles?.length ? result.points_cles : this._buildPointsCles(statsEnergies),
                  decisions:       result.decisions?.length   ? result.decisions   : this._buildDecisions(),
                  stats_energies:  statsEnergies,
                  anomalies_top3:  anomaliesTop3,
                };
              } else {
                this.rapportIA = this.construireRapportIALocal(statsEnergies, anomaliesTop3, nb_anomalies, now);
              }
              this.aiLoadingRapport = false;
              this.showToast('✅ Rapport IA généré !', 'success');
              this.cdr.detectChanges();
            },
            () => {
              this.rapportIA = this.construireRapportIALocal(statsEnergies, anomaliesTop3, nb_anomalies, now);
              this.aiLoadingRapport = false;
              this.cdr.detectChanges();
            }
          );
        },
        error: () => {
          this.rapportIA = this.construireRapportIALocal(statsEnergies, anomaliesTop3, nb_anomalies, now);
          this.aiLoadingRapport = false;
          this.cdr.detectChanges();
        }
      });
  }

  private construireRapportIALocal(
    statsEnergies: Record<string, StatEnergie>,
    anomaliesTop3: { energie: string; date: string; description: string; ecart_pct: number }[],
    nb_anomalies: number,
    now: Date
  ): RapportIA {
    const points_cles = this._buildPointsCles(statsEnergies);
    const decisions   = this._buildDecisions();

    // Résumé exécutif TOUJOURS complet et détaillé
    const resumeParts: string[] = [
      `Rapport généré le ${now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })} `
      + `sur ${this.mesuresFiltreesParDate.length} mesures (${this.dateRangeLabel}).`,
      `Score de santé énergétique : ${this.efficiencyScore}/100 (Grade ${this.efficiencyGrade}).`,
    ];

    const statsArr = Object.entries(statsEnergies);
    for (const [nom, stats] of statsArr) {
      if (stats.mois_actuel > 0) {
        if (stats.tendance === 'up') {
          resumeParts.push(
            `${nom} : hausse de ${stats.variation_pct > 0 ? '+' : ''}${stats.variation_pct}% ce mois `
            + `(${stats.mois_actuel} ${stats.unite}), prévision ${stats.prevision} ${stats.unite}.`
          );
        } else if (stats.tendance === 'down') {
          resumeParts.push(
            `${nom} : baisse positive de ${Math.abs(stats.variation_pct)}% ce mois `
            + `(${stats.mois_actuel} ${stats.unite}), prévision ${stats.prevision} ${stats.unite}.`
          );
        } else {
          resumeParts.push(
            `${nom} : stable à ${stats.mois_actuel} ${stats.unite} ce mois, `
            + `prévision ${stats.prevision} ${stats.unite}.`
          );
        }
      }
    }

    const hausses = statsArr.filter(([, s]) => s.tendance === 'up').length;
    if (hausses > 0) {
      resumeParts.push(`Des actions correctives sont recommandées pour les ${hausses} vecteur(s) en hausse.`);
    } else {
      resumeParts.push(`La situation énergétique globale est maîtrisée. Maintenir les bonnes pratiques en place.`);
    }

    return {
      date_generation: now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      nb_mesures:      this.mesuresFiltreesParDate.length,
      periode:         this.dateRangeLabel,
      score_sante:     this.efficiencyScore,
      nb_anomalies,
      resume_executif: resumeParts.join(' '),
      points_cles,
      decisions,
      stats_energies:  statsEnergies,
      anomalies_top3:  anomaliesTop3,
    };
  }

  // ─── Utilitaires rapport ──────────────────────────────────────────────────

  private _buildPointsCles(statsEnergies: Record<string, StatEnergie>): string[] {
    const points: string[] = [];

    for (const [nom, stats] of Object.entries(statsEnergies)) {
      if (stats.tendance === 'up' && stats.mois_actuel > 0) {
        points.push(
          `${nom} en hausse de ${stats.variation_pct > 0 ? '+' : ''}${stats.variation_pct}% — `
          + `${stats.mois_actuel} ${stats.unite} ce mois (prévision : ${stats.prevision} ${stats.unite}). `
          + `Audit des équipements recommandé en urgence.`
        );
      } else if (stats.tendance === 'down' && stats.mois_actuel > 0) {
        points.push(
          `${nom} en baisse positive de ${Math.abs(stats.variation_pct)}% — `
          + `${stats.mois_actuel} ${stats.unite} ce mois (prévision : ${stats.prevision} ${stats.unite}). `
          + `Documenter les actions pour pérenniser la tendance.`
        );
      }
    }

    if (this.alertesCritiques > 0) {
      points.push(`${this.alertesCritiques} alerte(s) critique(s) active(s) nécessitant une intervention immédiate.`);
    }

    if (this.equipementsMaintenance > 0) {
      points.push(`${this.equipementsMaintenance} équipement(s) en maintenance impactant potentiellement la performance énergétique.`);
    }

    if (points.length === 0) {
      const statsArr = Object.entries(statsEnergies).filter(([, s]) => s.mois_actuel > 0);
      if (statsArr.length > 0) {
        for (const [nom, stats] of statsArr.slice(0, 3)) {
          points.push(
            `${nom} stable — ${stats.mois_actuel} ${stats.unite} ce mois `
            + `(moyenne : ${stats.moyenne} ${stats.unite}). Maintenir le suivi.`
          );
        }
      } else {
        points.push('Aucun point critique identifié — situation globalement satisfaisante.');
        points.push(`Score d'efficacité : ${this.efficiencyScore}/100 (Grade ${this.efficiencyGrade}).`);
        points.push('Continuer les bonnes pratiques de gestion énergétique.');
      }
    }

    return points.slice(0, 4);
  }

  private _buildDecisions(): string[] {
    return [
      'Planifier un audit des équipements pour les énergies en hausse dans les 2 prochaines semaines.',
      'Réviser les seuils d\'alerte de consommation mensuelle pour chaque vecteur énergétique.',
      'Mettre en place un reporting hebdomadaire automatique pour les responsables énergie.',
      'Implémenter les recommandations prioritaires identifiées pour optimiser les coûts opérationnels.',
    ];
  }

  private getMoisTotal(energieId: number, offset: number): number {
    const now = new Date();
    const d   = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const fin = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
    return +this.mesures
      .filter(m => Number(m.energieId) === energieId)
      .filter(m => { const dm = new Date(m.dateMesure); return dm >= d && dm <= fin; })
      .reduce((s, m) => s + m.valeur, 0).toFixed(1);
  }

  getRapportStatsArray(): { nom: string; stats: StatEnergie }[] {
    if (!this.rapportIA?.stats_energies) return [];
    return Object.entries(this.rapportIA.stats_energies).map(([nom, stats]) => ({ nom, stats }));
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
  // loadAll — lance détectionAnomalies APRÈS chargement complet (sans race condition)
  // ══════════════════════════════════════════════════════════════════════════

  loadAll(): void {
    this.loading = true; this.apiErrors = {};
    let done = 0; const total = 7;
    const check = () => {
      if (++done < total) return;
      this.loading = false;
      this.initSeuilsFromEnergies();
      this.syncSeuilsActuelles();
      this.initBenchmarking();
      this.initPrevisions();
      this.buildForecastPoints();
      this.buildSparklines();
      this.emailObjetDefault = `Rapport IA Énergie WICMIC — ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

      // Appel direct sans setTimeout — mesures et energies sont garantis peuplés.
      // Le garde-fou dans lancerDetectionAnomalies() protège contre les cas vides.
      this.lancerDetectionAnomalies();
    };

    this.api.getMesures().subscribe({
      next:  (d: unknown[]) => { this.mesures = d.map(m => this.normalizeMesure(m)); check(); },
      error: ()             => { this.apiErrors['mesures'] = true; check(); },
    });
    this.api.getAlertes().subscribe({
      next:  (d: unknown[]) => { this.alertes = d.map(a => this.normalizeAlerte(a)); check(); },
      error: ()             => { this.apiErrors['alertes'] = true; check(); },
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
      next:  (d: Recommandation[]) => { this.recommandations = d; check(); },
      error: ()                    => { this.apiErrors['recommandations'] = true; check(); },
    });
    this.api.getEquipements().subscribe({
      next:  (d: unknown[]) => { this.equipements = d.map(e => this.normalizeEquipement(e)); check(); },
      error: ()             => { this.apiErrors['equipements'] = true; check(); },
    });
    this.api.getEnergies().subscribe({
      next:  (d: unknown[]) => { this.energies = d.map(e => this.normalizeEnergie(e)); check(); },
      error: ()             => { this.apiErrors['energies'] = true; check(); },
    });
    this.api.getZones().subscribe({
      next:  (d: Zone[]) => { this.zones = d; check(); },
      error: ()          => { this.apiErrors['zones'] = true; check(); },
    });
  }

  get hasApiErrors():  boolean  { return Object.keys(this.apiErrors).length > 0; }
  get apiErrorsList(): string[] { return Object.keys(this.apiErrors); }

  logout(): void { this.auth.logout(); }

  // ══════════════════════════════════════════════════════════════════════════
  // Email Modal — Rapport IA
  // ══════════════════════════════════════════════════════════════════════════

  isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  openEmailModal(): void {
    this.showEmailModal    = true;
    this.emailSent         = false;
    this.emailError        = '';
    this.emailObjetDefault = `Rapport IA Énergie WICMIC — ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
  }

  closeEmailModal(): void {
    this.showEmailModal    = false;
    this.emailSent         = false;
    this.emailError        = '';
    this.emailDestinataire = '';
    this.emailNom          = '';
    this.emailObjet        = '';
    this.emailNote         = '';
  }

  envoyerRapportEmail(): void {
    if (!this.emailDestinataire) return;
    this.emailSending = true;
    this.emailError   = '';

    this.http.post<{ job_id: string }>(
      `${this.RAG_URL}/rapport/email/start`,
      { email: this.emailDestinataire, nom: this.emailNom || 'Responsable Énergie' }
    ).pipe(timeout(10000), catchError(() => of(null)))
      .subscribe({
        next: res => {
          if (!res?.job_id) {
            this.emailSending = false;
            this.emailError = 'Service email indisponible.';
            this.showToast('❌ Service email indisponible.', 'error');
            return;
          }
          this.pollJob<{ success: boolean; message: string }>(
            res.job_id,
            `${this.RAG_URL}/rapport/email/result/${res.job_id}`,
            (result) => {
              this.emailSending = false;
              if (result?.success) {
                this.emailSent = true;
                this.showToast('✅ Rapport IA envoyé par email !', 'success');
                setTimeout(() => { this.closeEmailModal(); }, 2000);
              } else {
                this.emailError = result?.message ?? 'Erreur lors de l\'envoi.';
                this.showToast('❌ Erreur envoi email.', 'error');
              }
            },
            () => {
              this.emailSending = false;
              this.emailError = 'Erreur lors de l\'envoi du rapport.';
              this.showToast('❌ Erreur envoi email.', 'error');
            }
          );
        },
        error: () => {
          this.emailSending = false;
          this.emailError = 'Service email indisponible.';
          this.showToast('❌ Erreur envoi email.', 'error');
        }
      });
  }
}