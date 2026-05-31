import { Component, OnInit, OnDestroy, AfterViewChecked, ElementRef, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { interval, Subscription, forkJoin } from 'rxjs';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/core/auth/auth.service';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface Utilisateur {
  idUtilisateur: number;
  nom: string;
  email: string;
  password?: string;
  role: string;
}

export interface Site {
  idSite: number;
  nom: string;
  adresse?: string;
  description?: string;
  zones?: Zone[];
}

export interface Zone {
  idZone: number;
  nom: string;
  siteId: number;
  description?: string;
  site?: { idSite: number; nom: string };
}

export interface Equipement {
  idEquipement: number;
  nom: string;
  typeEquipement: string;
  statut: string;
  puissance?: number;
  localisation?: string;
  description?: string;
  energieId: number;
  zoneId?: number;
  energie?: { idEnergie: number; nom: string; unite: string };
  zone?: { idZone: number; nom: string };
}

export interface Mesure {
  idMesure: number;
  valeur: number;
  dateMesure: string;
  dateCreation: string;
  sourceDonnee: string;
  energieId: number;
  equipementId?: number;
  energie?: { idEnergie: number; nom: string; unite: string };
  equipement?: { idEquipement: number; nom: string; typeEquipement: string };
}

export interface Alerte {
  idAlerte: number;
  type: string;
  message: string;
  statut: string;
  dateCreation: string;
  energieId?: number;
  equipementId?: number;
  energie?: { idEnergie: number; nom: string };
  equipement?: { idEquipement: number; nom: string };
}

export interface AlerteArchivee extends Alerte {
  archivedAt: string;
}

export interface Energie {
  idEnergie: number;
  nom: string;
  unite: string;
  description?: string;
  facteurConversion?: number;
  couleur?: string;
}

// ─── Seuil ────────────────────────────────────────────────────────────────────
export interface Seuil {
  idSeuil?: number;        // id en base (optionnel si local)
  energieId: number;
  energieNom: string;
  energieUnite: string;
  valeurSeuil: number;     // valeur limite
  periode: 'Journalier' | 'Hebdomadaire' | 'Mensuel' | 'Annuel';
  actif: boolean;
  couleur?: string;
  // Calculé localement
  consommationActuelle?: number;
  depassement?: boolean;
  pct?: number;
}

export interface ConfirmDialogConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: string;
  onConfirm: () => void;
}

// ─── Helpers statut alerte ────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const STATUTS_RESOLUS_KEYWORDS = [
  'resolue', 'resolu', 'resolved', 'closed', 'fermee', 'ferme',
  'traite', 'traitee', 'termine', 'terminee', 'done', 'fixed',
  'cloture', 'close',
];

export function isAlerteResolue(statut: string): boolean {
  if (!statut || statut.toString().trim() === '') return false;
  const s = normalizeStr(statut);
  return STATUTS_RESOLUS_KEYWORDS.some(k => s.includes(k));
}

export function isAlerteActive(statut: string): boolean {
  return !isAlerteResolue(statut);
}

// ─── Détection sociale ────────────────────────────────────────────────────────

const ADMIN_SOCIAL_WORDS = new Set([
  'merci', 'thanks', 'thank you', 'super', 'parfait', 'ok', 'okay',
  'bien', 'bonne journée', 'bonsoir', 'bonjour', 'salut', 'hello',
  'au revoir', 'bye', 'nickel', 'top', 'cool', "d'accord", 'daccord',
  'compris', 'vu', '👍', '🙏', '😊',
]);

const ADMIN_BUSINESS_WORDS = [
  'consomm', 'kwh', 'énergi', 'energi', 'alert', 'équip', 'equip',
  'mesur', 'rapport', 'score', 'prévi', 'previ', 'benchmark',
  'eau', 'gasoil', 'électri', 'electri', 'compresseur',
  'réduct', 'reduc', 'seuil', 'tendance', 'analyse', 'factur',
  'site', 'zone', 'utilisateur', 'admin', 'statut', 'kpi',
];

function isAdminSocialMessage(msg: string): boolean {
  const normalized = msg.trim().toLowerCase().replace(/[!.,?]/g, '');
  const words = normalized.split(/\s+/);
  return ADMIN_SOCIAL_WORDS.has(normalized)
    || (words.length <= 4 && !ADMIN_BUSINESS_WORDS.some(kw => normalized.includes(kw)));
}

const ADMIN_SOCIAL_RESPONSES: Record<string, string> = {
  'merci':         'De rien ! N\'hésitez pas si vous avez d\'autres questions. 😊',
  'thanks':        'You\'re welcome! Feel free to ask anytime.',
  'thank you':     'You\'re welcome! Feel free to ask anytime.',
  'super':         'Parfait ! Je reste disponible pour toute analyse. 👍',
  'parfait':       'Parfait ! Je reste disponible pour toute analyse. 👍',
  'nickel':        'Parfait ! Je reste disponible pour toute analyse. 👍',
  'top':           'Merci ! Posez-moi vos questions sur la plateforme quand vous voulez.',
  'cool':          'Merci ! Posez-moi vos questions sur la plateforme quand vous voulez.',
  'bonne journée': 'Bonne journée à vous également ! À bientôt. 👋',
  'bonsoir':       'Bonsoir ! Comment puis-je vous aider ce soir ?',
  'bonjour':       'Bonjour ! Comment puis-je vous aider avec la gestion de la plateforme ?',
  'salut':         'Bonjour ! Comment puis-je vous aider avec la gestion de la plateforme ?',
  'hello':         'Bonjour ! Comment puis-je vous aider avec la gestion de la plateforme ?',
  'au revoir':     'À bientôt ! N\'hésitez pas à revenir. 👋',
  'bye':           'À bientôt ! 👋',
  'ok':            'Parfait, je reste disponible si vous avez besoin d\'informations.',
  'okay':          'Parfait, je reste disponible si vous avez besoin d\'informations.',
  'bien':          'Très bien ! N\'hésitez pas à poser d\'autres questions.',
  "d'accord":      'Très bien ! N\'hésitez pas à poser d\'autres questions.',
  'daccord':       'Très bien ! N\'hésitez pas à poser d\'autres questions.',
  'compris':       'Parfait ! Je suis là si vous avez besoin d\'autres informations.',
  'vu':            'Parfait ! Je suis là si vous avez besoin d\'autres informations.',
  '👍':            '😊 Je reste disponible pour toute question !',
  '🙏':            'De rien ! À votre service. 😊',
  '😊':            '😊 N\'hésitez pas si vous avez d\'autres questions !',
};

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit, OnDestroy, AfterViewChecked {

  @ViewChild('iaMessagesContainer') iaMessagesContainer!: ElementRef;
  @ViewChild('lineChartCanvas') lineChartCanvas!: ElementRef<HTMLCanvasElement>;

  Math = Math;
  private readonly API     = 'https://localhost:7128/api';
  private readonly RAG_URL = 'http://localhost:8000';

  private lineChartInstance: any = null;
  private chartJsLoaded         = false;

  // ── Navigation ──────────────────────────────────────────────────────────────
  activeSection    = 'accueil';
  sidebarCollapsed = false;
  loading          = false;
  toastMessage     = '';
  toastType: 'success' | 'error' | 'info' = 'success';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldScrollChat  = false;
  private shouldRenderChart = false;

  // ── Modale de confirmation ──────────────────────────────────────────────────
  confirmDialog: ConfirmDialogConfig | null = null;
  showConfirmDialog = false;

  get mainStyle(): { [key: string]: string } {
    return { 'margin-left': this.sidebarCollapsed ? '64px' : '240px' };
  }

  // ── Clock ───────────────────────────────────────────────────────────────────
  currentTime = '';
  currentDate = '';
  clockSub!: Subscription;

  // ── Admin Info ───────────────────────────────────────────────────────────────
  adminName    = '';
  adminEmail   = '';
  adminRole    = '';
  platformName = 'WICMIC TriPower v1';

  // ── KPIs ────────────────────────────────────────────────────────────────────
  totalSites        = 0;
  totalEquipements  = 0;
  totalMesures      = 0;
  totalUtilisateurs = 0;
  zonesCount        = 0;
  santeSysteme      = 100;
  consommationTotale  = 0;
  consommationMoyenne = 0;
  consommationMax     = 0;
  consommationMin     = 0;

  // ── Données API ──────────────────────────────────────────────────────────────
  utilisateurs: Utilisateur[] = [];
  equipements:  Equipement[]  = [];
  mesures:      Mesure[]      = [];
  alertes:      Alerte[]      = [];
  sites:        Site[]        = [];
  zones:        Zone[]        = [];
  energies:     Energie[]     = [];

  // ── Répartition ──────────────────────────────────────────────────────────────
  repartitionEnergies: { nom: string; pct: number; couleur: string }[] = [];

  get repartitionElec():   number { return this.repartitionEnergies.find(e => this.isElec(e.nom))?.pct   ?? 0; }
  get repartitionEau():    number { return this.repartitionEnergies.find(e => this.isEau(e.nom))?.pct    ?? 0; }
  get repartitionGasoil(): number { return this.repartitionEnergies.find(e => this.isGasoil(e.nom))?.pct ?? 0; }

  // ── Chart Data ────────────────────────────────────────────────────────────────
  chartData: { labels: string[]; electricite: number[]; eau: number[]; gasoil: number[] } = {
    labels: [], electricite: [], eau: [], gasoil: []
  };

  get chartTotalElec():   number { return Math.round(this.chartData.electricite.reduce((a, b) => a + b, 0)); }
  get chartTotalEau():    number { return Math.round(this.chartData.eau.reduce((a, b) => a + b, 0)); }
  get chartTotalGasoil(): number { return Math.round(this.chartData.gasoil.reduce((a, b) => a + b, 0)); }

  // ── Filtres date globaux ──────────────────────────────────────────────────────
  filterDateDebut = '';
  filterDateFin   = '';

  // ── Utilisateurs UI ──────────────────────────────────────────────────────────
  searchUser       = '';
  showNewUserModal = false;
  editingUser:     Utilisateur | null = null;
  newUser: Partial<Utilisateur & { password: string }> = { nom: '', email: '', password: '', role: 'employé' };

  // ── Sites UI ─────────────────────────────────────────────────────────────────
  searchSite    = '';
  showSiteModal = false;
  editingSite:  Site | null = null;
  newSite: { nom: string; adresse: string; description: string } = { nom: '', adresse: '', description: '' };

  // ── Zones UI ─────────────────────────────────────────────────────────────────
  searchZone     = '';
  filtreZoneSite = '';
  showZoneModal  = false;
  editingZone:   Zone | null = null;
  newZone: Partial<Zone> = { nom: '', siteId: undefined, description: '' };

  // ── Équipements UI ───────────────────────────────────────────────────────────
  searchEquipement    = '';
  filtreZone          = 'Toutes les zones';
  filtreType          = 'Tous les types';
  viewMode: 'grid' | 'list' = 'grid';
  showEquipementModal = false;
  editingEquipement:  Equipement | null = null;
  newEquipement: Partial<Equipement> = {
    nom: '', typeEquipement: '', statut: 'actif', puissance: undefined,
    energieId: undefined, zoneId: undefined, description: ''
  };

  // ── Mesures UI ───────────────────────────────────────────────────────────────
  searchMesure    = '';
  sortMesure      = 'Date — récent';
  mesuresPage     = 1;
  mesuresPerPage  = 20;
  showMesureModal = false;
  editingMesure:  Mesure | null = null;
  mesureDateDebut = '';
  mesureDateFin   = '';
  newMesure: Partial<Mesure> = {
    valeur: 0, dateMesure: new Date().toISOString().slice(0, 16),
    sourceDonnee: '', energieId: undefined, equipementId: undefined
  };

  // ── Alertes UI ───────────────────────────────────────────────────────────────
  searchAlerte    = '';
  filtreAlerte    = 'Toutes';
  alerteDateDebut = '';
  alerteDateFin   = '';
  showAlerteModal = false;
  editingAlerte:  Alerte | null = null;
  newAlerte: Partial<Alerte> = {
    type: '', message: '', statut: 'active', energieId: undefined, equipementId: undefined
  };

  // ── Archives alertes ──────────────────────────────────────────────────────────
  alertesArchivees: AlerteArchivee[] = [];
  showArchives  = false;
  searchArchive = '';

  // ── Énergies UI ──────────────────────────────────────────────────────────────
  searchEnergie     = '';
  showEnergieModal  = false;
  editingEnergie:   Energie | null = null;
  newEnergie: Partial<Energie> = {
    nom: '', unite: '', description: '', facteurConversion: 1, couleur: '#6366f1'
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // SEUILS
  // ══════════════════════════════════════════════════════════════════════════════
  seuils:           Seuil[]  = [];
  searchSeuil       = '';
  filtreSeuil       = 'Tous';      // 'Tous' | 'Actifs' | 'Dépassés'
  showSeuilModal    = false;
  editingSeuil:     Seuil | null = null;
  seuilSaving       = false;
  newSeuil: Partial<Seuil> = {
    energieId: undefined,
    valeurSeuil: 0,
    periode: 'Mensuel',
    actif: true,
  };

  // ── Profil ───────────────────────────────────────────────────────────────────
  motDePasseActuel    = '';
  nouveauMotDePasse   = '';
  confirmerMotDePasse = '';
  showPassActuel  = false;
  showPassNouveau = false;
  showPassConfirm = false;

  // ── IA ───────────────────────────────────────────────────────────────────────
  ollamaUrl   = 'http://localhost:11434/api/generate';
  ollamaModel = 'llama3';

  iaMessages: { role: 'user' | 'assistant'; content: string; timestamp: string }[] = [];
  iaInput          = '';
  iaLoading        = false;
  iaTotalMessages  = 0;
  iaTotalQuestions = 0;
  iaSuggestedQuestions = [
    { label: 'CONSO',       text: 'Quelle est la consommation totale actuelle ?' },
    { label: 'ALERTES',     text: 'Quelles sont les alertes actives ?' },
    { label: 'TENDANCE',    text: 'Quelle est la tendance de consommation ?' },
    { label: 'EAU',         text: 'Analysez la consommation en eau.' },
    { label: 'GASOIL',      text: 'Analysez la consommation de gasoil.' },
    { label: 'EQUIPEMENTS', text: 'Quels équipements consomment le plus ?' },
    { label: 'PERFORMANCE', text: 'Donnez-moi un résumé de performance.' }
  ];

  // ── Export ───────────────────────────────────────────────────────────────────
  exportingPDF   = false;
  exportingExcel = false;

  // ── PDF Colors ───────────────────────────────────────────────────────────────
  private readonly PDF_COLORS = {
    navy:     [15,  23,  42]  as [number, number, number],
    indigo:   [99,  102, 241] as [number, number, number],
    blue:     [59,  130, 246] as [number, number, number],
    purple:   [168, 85,  247] as [number, number, number],
    cyan:     [6,   182, 212] as [number, number, number],
    green:    [34,  197, 94]  as [number, number, number],
    amber:    [245, 158, 11]  as [number, number, number],
    red:      [239, 68,  68]  as [number, number, number],
    white:    [255, 255, 255] as [number, number, number],
    grayBg:   [248, 250, 252] as [number, number, number],
    grayLine: [226, 232, 240] as [number, number, number],
    textMain: [30,  41,  59]  as [number, number, number],
    textMuted:[100, 116, 139] as [number, number, number],
  };

  constructor(
    private http:   HttpClient,
    private router: Router,
    private auth:   AuthService
  ) {}

  // ══════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════════

  ngOnInit(): void {
    const user = this.auth.getCurrentUser();
    if (!user || !this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.adminName  = user.nom;
    this.adminEmail = user.email;
    this.adminRole  = user.role;

    const today = new Date();
    const past  = new Date();
    past.setDate(today.getDate() - 30);
    this.filterDateDebut  = past.toISOString().split('T')[0];
    this.filterDateFin    = today.toISOString().split('T')[0];
    this.mesureDateDebut  = this.filterDateDebut;
    this.mesureDateFin    = this.filterDateFin;
    this.alerteDateDebut  = '';
    this.alerteDateFin    = '';

    this.updateClock();
    this.clockSub = interval(1000).subscribe(() => this.updateClock());
    this.loadChartJs().then(() => this.loadAllData());
  }

  ngOnDestroy(): void {
    this.clockSub?.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.destroyChart();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollChat && this.iaMessagesContainer) {
      const el = this.iaMessagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollChat = false;
    }
    if (this.shouldRenderChart && this.lineChartCanvas?.nativeElement && this.chartJsLoaded) {
      this.shouldRenderChart = false;
      this.renderLineChart();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // CHART.JS
  // ══════════════════════════════════════════════════════════════════════════════

  private loadChartJs(): Promise<void> {
    if ((window as any).Chart) { this.chartJsLoaded = true; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const script   = document.createElement('script');
      script.src     = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      script.onload  = () => { this.chartJsLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Impossible de charger Chart.js'));
      document.head.appendChild(script);
    });
  }

  private destroyChart(): void {
    if (this.lineChartInstance) { this.lineChartInstance.destroy(); this.lineChartInstance = null; }
  }

  private renderLineChart(): void {
    if (!this.chartJsLoaded || !this.lineChartCanvas?.nativeElement || !this.chartData.labels.length) return;
    this.destroyChart();
    const ctx = this.lineChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const ChartJS = (window as any).Chart;
    this.lineChartInstance = new ChartJS(ctx, {
      type: 'line',
      data: {
        labels: this.chartData.labels,
        datasets: [
          { label: 'Électricité', data: this.chartData.electricite, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', pointBackgroundColor: '#3b82f6', pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5, tension: 0.38, fill: true },
          { label: 'Eau',         data: this.chartData.eau,         borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,0.07)', pointBackgroundColor: '#14b8a6', pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5, tension: 0.38, fill: true, borderDash: [6, 4] },
          { label: 'Gasoil',      data: this.chartData.gasoil,      borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.07)', pointBackgroundColor: '#f59e0b', pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5, tension: 0.38, fill: true, borderDash: [2, 4] },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff', borderColor: 'rgba(0,0,0,0.10)', borderWidth: 1,
            titleColor: '#374151', bodyColor: '#6b7280', padding: 11,
            callbacks: { label: (ctx: any) => { const u = ctx.datasetIndex === 0 ? 'kWh' : ctx.datasetIndex === 1 ? 'm³' : 'L'; return ` ${ctx.dataset.label} : ${ctx.parsed.y.toLocaleString('fr-FR')} ${u}`; } }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: 'rgba(0,0,0,0.45)', font: { size: 12 }, autoSkip: false, maxRotation: 0 } },
          y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: 'rgba(0,0,0,0.45)', font: { size: 11 }, callback: (v: number) => v.toLocaleString('fr-FR') }, beginAtZero: true }
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MODALE DE CONFIRMATION
  // ══════════════════════════════════════════════════════════════════════════════

  openConfirm(config: ConfirmDialogConfig): void { this.confirmDialog = config; this.showConfirmDialog = true; }
  confirmAction(): void { if (this.confirmDialog?.onConfirm) this.confirmDialog.onConfirm(); this.closeConfirm(); }
  closeConfirm(): void { this.showConfirmDialog = false; this.confirmDialog = null; }

  // ══════════════════════════════════════════════════════════════════════════════
  // TOAST
  // ══════════════════════════════════════════════════════════════════════════════

  showToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
    this.toastMessage = message;
    this.toastType    = type;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastMessage = ''; }, 3500);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DATE FILTER HELPERS
  // ══════════════════════════════════════════════════════════════════════════════

  clearDateFilter(scope: 'mesures' | 'alertes' | 'global'): void {
    if (scope === 'mesures' || scope === 'global') { this.mesureDateDebut = ''; this.mesureDateFin = ''; }
    if (scope === 'alertes' || scope === 'global') { this.alerteDateDebut = ''; this.alerteDateFin = ''; }
    if (scope === 'global') { this.filterDateDebut = ''; this.filterDateFin = ''; }
    this.mesuresPage = 1;
  }

  private dateInRange(dateStr: string, debut: string, fin: string): boolean {
    if (!debut && !fin) return true;
    if (!dateStr) return true;
    try {
      const d = new Date(dateStr).getTime();
      if (isNaN(d)) return true;
      if (debut && d < new Date(debut).getTime()) return false;
      if (fin   && d > new Date(fin + 'T23:59:59').getTime()) return false;
      return true;
    } catch { return true; }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ══════════════════════════════════════════════════════════════════════════════

  loadAllData(): void {
    this.loading = true;
    forkJoin({
      utilisateurs: this.http.get<Utilisateur[]>(`${this.API}/Utilisateurs`),
      equipements:  this.http.get<Equipement[]>(`${this.API}/Equipements`),
      mesures:      this.http.get<Mesure[]>(`${this.API}/Mesures`),
      alertes:      this.http.get<Alerte[]>(`${this.API}/Alertes`),
      sites:        this.http.get<Site[]>(`${this.API}/Sites`),
      zones:        this.http.get<Zone[]>(`${this.API}/Zones`),
      energies:     this.http.get<Energie[]>(`${this.API}/Energies`),
    }).subscribe({
      next: (data) => {
        this.utilisateurs = data.utilisateurs || [];
        this.equipements  = data.equipements  || [];
        this.mesures      = data.mesures      || [];
        this.alertes      = data.alertes      || [];
        this.sites        = data.sites        || [];
        this.zones        = data.zones        || [];
        this.energies     = data.energies     || [];
        this.computeKPIs();
        this.computeRepartition();
        this.computeChartData();
        this.initSeuilsFromEnergies();
        this.loading = false;
      },
      error: (err) => {
        console.error('Erreur chargement données:', err);
        this.showToast('Erreur lors du chargement des données', 'error');
        this.loading = false;
      }
    });
  }

  private refreshAfterChange(): void {
    this.computeKPIs();
    this.computeRepartition();
    this.computeChartData();
    this.syncSeuilsConsommation();
  }

  reloadMesures(): void {
    this.http.get<Mesure[]>(`${this.API}/Mesures`).subscribe({
      next:  data => {
        this.mesures = data || [];
        this.refreshAfterChange();
        // Vérifier les dépassements après rechargement
        this.verifierDepassementsSeuils();
      },
      error: ()   => this.showToast('Erreur rechargement mesures', 'error')
    });
  }

  reloadAlertes(): void {
    this.http.get<Alerte[]>(`${this.API}/Alertes`).subscribe({
      next: data => {
        this.alertes = data || [];
        this.computeKPIs();
      },
      error: () => this.showToast('Erreur rechargement alertes', 'error')
    });
  }

  reloadUtilisateurs(): void {
    this.http.get<Utilisateur[]>(`${this.API}/Utilisateurs`).subscribe({
      next:  data => { this.utilisateurs = data || []; this.totalUtilisateurs = this.utilisateurs.length; },
      error: ()   => this.showToast('Erreur rechargement utilisateurs', 'error')
    });
  }

  reloadSites(): void {
    this.http.get<Site[]>(`${this.API}/Sites`).subscribe({
      next: data => { this.sites = data || []; this.totalSites = this.sites.length; this.showToast('Sites rechargés', 'success'); },
      error: () => this.showToast('Erreur rechargement sites', 'error')
    });
  }

  reloadZones(): void {
    this.http.get<Zone[]>(`${this.API}/Zones`).subscribe({
      next: data => { this.zones = data || []; this.zonesCount = this.zones.length; this.showToast('Zones rechargées', 'success'); },
      error: () => this.showToast('Erreur rechargement zones', 'error')
    });
  }

  reloadEnergies(): void {
    this.http.get<Energie[]>(`${this.API}/Energies`).subscribe({
      next: data => {
        this.energies = data || [];
        this.computeRepartition();
        this.computeChartData();
        this.initSeuilsFromEnergies();
        this.showToast('Énergies rechargées', 'success');
      },
      error: () => this.showToast('Erreur rechargement énergies', 'error')
    });
  }

  reloadEquipements(): void {
    this.http.get<Equipement[]>(`${this.API}/Equipements`).subscribe({
      next: data => { this.equipements = data || []; this.totalEquipements = this.equipements.length; this.showToast('Équipements rechargés', 'success'); },
      error: () => this.showToast('Erreur rechargement équipements', 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // KPIs
  // ══════════════════════════════════════════════════════════════════════════════

  get alertesActives(): number {
    return this.alertes.filter(a => isAlerteActive(a.statut)).length;
  }

  get alertesResolues(): number {
    return this.alertes.filter(a => isAlerteResolue(a.statut)).length;
  }

  computeKPIs(): void {
    this.totalUtilisateurs = this.utilisateurs.length;
    this.totalEquipements  = this.equipements.length;
    this.totalMesures      = this.mesures.length;
    this.totalSites        = this.sites.length;
    this.zonesCount        = this.zones.length;

    if (this.mesures.length) {
      const vals               = this.mesures.map(m => Number(m.valeur) || 0);
      this.consommationTotale  = Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
      this.consommationMoyenne = Math.round((this.consommationTotale / vals.length) * 100) / 100;
      this.consommationMax     = Math.max(...vals);
      this.consommationMin     = Math.min(...vals);
    } else {
      this.consommationTotale = this.consommationMoyenne = this.consommationMax = this.consommationMin = 0;
    }

    const total   = this.alertes.length;
    const actives = this.alertesActives;
    this.santeSysteme = total === 0
      ? 100
      : Math.max(0, Math.round((1 - actives / total) * 100));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // KPIs CONTEXTUALISÉS
  // ══════════════════════════════════════════════════════════════════════════════

  get mesuresCetteSemaine(): number {
    const debut = new Date(); debut.setDate(debut.getDate() - 7); debut.setHours(0, 0, 0, 0);
    return this.mesures.filter(m => new Date(m.dateMesure) >= debut).length;
  }

  get mesuresSemainePassee(): number {
    const d1 = new Date(); d1.setDate(d1.getDate() - 14); d1.setHours(0, 0, 0, 0);
    const d2 = new Date(); d2.setDate(d2.getDate() - 7);  d2.setHours(23, 59, 59, 999);
    return this.mesures.filter(m => { const d = new Date(m.dateMesure); return d >= d1 && d <= d2; }).length;
  }

  get variationMesures(): number {
    const prev = this.mesuresSemainePassee;
    if (!prev) return this.mesuresCetteSemaine > 0 ? 100 : 0;
    return Math.round(((this.mesuresCetteSemaine - prev) / prev) * 100);
  }

  get alertesAujourdhui(): number {
    const today = new Date().toISOString().split('T')[0];
    return this.alertes.filter(a =>
      isAlerteActive(a.statut) && (a.dateCreation ?? '').startsWith(today)
    ).length;
  }

  get equipementsEnLigne(): number {
    return this.equipements.filter(e =>
      ['actif', 'active', 'on', 'en ligne'].includes((e.statut ?? '').toLowerCase())
    ).length;
  }

  get equipementsEnMaintenance(): number {
    return this.equipements.filter(e => (e.statut ?? '').toLowerCase().includes('maintenance')).length;
  }

  get equipementsDegrades(): number {
    return this.equipements.filter(e =>
      ['inactif', 'inactive', 'off', 'hors ligne'].includes((e.statut ?? '').toLowerCase())
    ).length;
  }

  get consommationAujourdhui(): number {
    const today = new Date().toISOString().split('T')[0];
    return Math.round(this.mesures.filter(m => (m.dateMesure ?? '').startsWith(today)).reduce((s, m) => s + (Number(m.valeur) || 0), 0) * 100) / 100;
  }

  get consommationHier(): number {
    const hier = new Date(); hier.setDate(hier.getDate() - 1);
    const hierStr = hier.toISOString().split('T')[0];
    return Math.round(this.mesures.filter(m => (m.dateMesure ?? '').startsWith(hierStr)).reduce((s, m) => s + (Number(m.valeur) || 0), 0) * 100) / 100;
  }

  get variationConso(): number {
    if (!this.consommationHier) return 0;
    return Math.round(((this.consommationAujourdhui - this.consommationHier) / this.consommationHier) * 100);
  }

  get objectifSante(): number { return 95; }

  get sitesAvecZones(): number { return this.sites.filter(s => this.getSiteZonesCount(s.idSite) > 0).length; }
  get zonesAvecEquipements(): number { return this.zones.filter(z => this.getZoneEquipCount(z.idZone) > 0).length; }

  // ══════════════════════════════════════════════════════════════════════════════
  // HELPERS ÉNERGIES
  // ══════════════════════════════════════════════════════════════════════════════

  private getEnergieIdByPattern(pattern: string): number | null {
    const p = normalizeStr(pattern);
    const found = this.energies.find(e => normalizeStr(e.nom).includes(p));
    return found ? found.idEnergie : null;
  }

  isElec(nom: string):   boolean { return normalizeStr(nom).includes('elec'); }
  isEau(nom: string):    boolean { const n = normalizeStr(nom); return n.includes('eau') || n.includes('water'); }
  isGasoil(nom: string): boolean { const n = normalizeStr(nom); return n.includes('gazoil') || n.includes('diesel') || n.includes('fioul') || n.includes('gazole'); }

  // ══════════════════════════════════════════════════════════════════════════════
  // RÉPARTITION & CHART
  // ══════════════════════════════════════════════════════════════════════════════

  computeRepartition(): void {
    const total = this.mesures.reduce((s, m) => s + (Number(m.valeur) || 0), 0);
    if (!total || !this.energies.length) { this.repartitionEnergies = []; return; }
    this.repartitionEnergies = this.energies.map(energie => ({
      nom: energie.nom,
      pct: Math.round((this.mesures.filter(m => m.energieId === energie.idEnergie).reduce((s, m) => s + (Number(m.valeur) || 0), 0) / total) * 100),
      couleur: this.getEnergieColor(energie)
    })).filter(e => e.pct > 0);
  }

  computeChartData(): void {
    const moisMap    = new Map<string, Map<number, number>>();
    const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    this.mesures.forEach(m => {
      const d = new Date(m.dateMesure);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!moisMap.has(key)) moisMap.set(key, new Map());
      const entry = moisMap.get(key)!;
      entry.set(m.energieId, (entry.get(m.energieId) ?? 0) + (Number(m.valeur) || 0));
    });
    const sorted   = Array.from(moisMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
    const elecId   = this.getEnergieIdByPattern('elec');
    const eauId    = this.getEnergieIdByPattern('eau');
    const gasoilId = this.getEnergieIdByPattern('gazoil');
    this.chartData = {
      labels:      sorted.map(([k]) => moisLabels[parseInt(k.split('-')[1]) - 1]),
      electricite: sorted.map(([, map]) => Math.round(elecId   !== null ? (map.get(elecId)   ?? 0) : 0)),
      eau:         sorted.map(([, map]) => Math.round(eauId    !== null ? (map.get(eauId)    ?? 0) : 0)),
      gasoil:      sorted.map(([, map]) => Math.round(gasoilId !== null ? (map.get(gasoilId) ?? 0) : 0)),
    };
    if (this.activeSection === 'dashboard' && this.lineChartCanvas?.nativeElement && this.chartJsLoaded) {
      this.renderLineChart();
    } else {
      this.shouldRenderChart = true;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════════

  navigate(section: string): void {
    this.activeSection = section;
    this.mesuresPage   = 1;
    if (section === 'utilisateurs')                                   this.reloadUtilisateurs();
    if (section === 'mesures')                                        this.reloadMesures();
    if (section === 'alertes-admin' || section === 'toutes-alertes') this.reloadAlertes();
    if (section === 'sites')                                          this.reloadSites();
    if (section === 'zones')                                          this.reloadZones();
    if (section === 'energies')                                       this.reloadEnergies();
    if (section === 'equipements')                                    this.reloadEquipements();
    if (section === 'accueil')                                        this.reloadAlertes();
    if (section === 'seuils')                                         this.reloadSeuilsData();
    if (section === 'dashboard') { this.reloadAlertes(); this.shouldRenderChart = true; }
  }

  toggleSidebar(): void { this.sidebarCollapsed = !this.sidebarCollapsed; }
  logout(): void { this.auth.logout(); }

  // ══════════════════════════════════════════════════════════════════════════════
  // UTILISATEURS — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredUsers(): Utilisateur[] {
    if (!this.searchUser) return this.utilisateurs;
    const q = this.searchUser.toLowerCase();
    return this.utilisateurs.filter(u => u.nom.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }

  get adminCount(): number { return this.utilisateurs.filter(u => u.role.toLowerCase().includes('admin')).length; }
  get respCount():  number { return this.utilisateurs.filter(u => u.role.toLowerCase().includes('responsable')).length; }
  get empCount():   number { return this.utilisateurs.filter(u => u.role.toLowerCase().includes('employ')).length; }

  get donutCircumference(): number { return 2 * Math.PI * 54; }
  get donutAdminPct(): number { return this.utilisateurs.length ? (this.adminCount / this.utilisateurs.length) * 100 : 0; }
  get donutRespPct():  number { return this.utilisateurs.length ? (this.respCount  / this.utilisateurs.length) * 100 : 0; }
  get donutEmpPct():   number { return this.utilisateurs.length ? (this.empCount   / this.utilisateurs.length) * 100 : 0; }
  donutOffset(pct: number): number { return (pct / 100) * this.donutCircumference; }
  donutDash(pct: number):   number { return (pct / 100) * this.donutCircumference; }

  openNewUser(): void { this.newUser = { nom: '', email: '', password: '', role: 'employé' }; this.editingUser = null; this.showNewUserModal = true; }

  editUser(user: Utilisateur): void {
    this.editingUser = { ...user };
    this.newUser = { nom: user.nom, email: user.email, role: user.role };
    this.showNewUserModal = true;
  }

  saveUser(): void {
    if (!this.newUser.nom?.trim() || !this.newUser.email?.trim()) { this.showToast('Nom et email requis', 'error'); return; }
    if (!this.editingUser && !this.newUser.password?.trim()) { this.showToast('Mot de passe requis', 'error'); return; }
    if (this.editingUser) {
      const payload = { ...this.editingUser, nom: this.newUser.nom, email: this.newUser.email, role: this.newUser.role };
      this.http.put(`${this.API}/Utilisateurs/${this.editingUser.idUtilisateur}`, payload).subscribe({
        next: () => { this.showNewUserModal = false; this.editingUser = null; this.reloadUtilisateurs(); this.showToast('Utilisateur modifié avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Utilisateur>(`${this.API}/Utilisateurs`, this.newUser).subscribe({
        next: () => { this.showNewUserModal = false; this.reloadUtilisateurs(); this.showToast('Utilisateur créé avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteUser(id: number, nom: string): void {
    this.openConfirm({
      title: 'Supprimer l\'utilisateur',
      message: `Êtes-vous sûr de vouloir supprimer l'utilisateur <strong>"${nom}"</strong> ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer', icon: '👤', danger: true,
      onConfirm: () => {
        this.http.delete(`${this.API}/Utilisateurs/${id}`).subscribe({
          next: () => { this.utilisateurs = this.utilisateurs.filter(u => u.idUtilisateur !== id); this.computeKPIs(); this.showToast('Utilisateur supprimé', 'success'); },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  getUserAvatar(nom: string): string { return nom?.length > 0 ? nom[0].toUpperCase() : '?'; }

  // ══════════════════════════════════════════════════════════════════════════════
  // SITES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredSites(): Site[] {
    if (!this.searchSite) return this.sites;
    const q = this.searchSite.toLowerCase();
    return this.sites.filter(s => (s.nom ?? '').toLowerCase().includes(q) || (s.adresse ?? '').toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q));
  }

  getSiteZonesCount(siteId: number): number { return this.zones.filter(z => Number(z.siteId) === Number(siteId)).length; }
  getSiteEquipCount(siteId: number): number {
    const zoneIds = this.zones.filter(z => Number(z.siteId) === Number(siteId)).map(z => z.idZone);
    return this.equipements.filter(e => e.zoneId !== undefined && zoneIds.includes(Number(e.zoneId))).length;
  }

  openNewSite(): void { this.newSite = { nom: '', adresse: '', description: '' }; this.editingSite = null; this.showSiteModal = true; }

  editSite(site: Site): void {
    this.editingSite = { ...site };
    this.newSite = { nom: site.nom ?? '', adresse: site.adresse ?? '', description: site.description ?? '' };
    this.showSiteModal = true;
  }

  saveSite(): void {
    const nomTrimmed = (this.newSite.nom ?? '').trim();
    if (!nomTrimmed) { this.showToast('Le nom du site est requis', 'error'); return; }
    const payload = { nom: nomTrimmed, adresse: (this.newSite.adresse ?? '').trim() || null, description: (this.newSite.description ?? '').trim() || null };
    if (this.editingSite) {
      this.http.put(`${this.API}/Sites/${this.editingSite.idSite}`, { idSite: this.editingSite.idSite, ...payload }).subscribe({
        next: () => { this.showSiteModal = false; this.editingSite = null; this.newSite = { nom: '', adresse: '', description: '' }; this.showToast('Site modifié avec succès', 'success'); this.http.get<Site[]>(`${this.API}/Sites`).subscribe({ next: data => { this.sites = data || []; this.totalSites = this.sites.length; } }); },
        error: (e: any) => this.showToast('Erreur modification site : ' + (e.error?.message || e.error?.title || e.statusText), 'error')
      });
    } else {
      this.http.post<Site>(`${this.API}/Sites`, payload).subscribe({
        next: (created) => {
          this.showSiteModal = false; this.showToast('Site créé avec succès', 'success');
          this.http.get<Site[]>(`${this.API}/Sites`).subscribe({
            next: data => { this.sites = data || []; this.totalSites = this.sites.length; this.newSite = { nom: '', adresse: '', description: '' }; },
            error: () => { this.sites = [...this.sites, created ?? { idSite: Date.now(), nom: payload.nom }]; this.totalSites = this.sites.length; this.newSite = { nom: '', adresse: '', description: '' }; }
          });
        },
        error: (e) => this.showToast('Erreur création site : ' + (e.error?.message || e.error?.title || e.statusText), 'error')
      });
    }
  }

  deleteSite(id: number, nom: string): void {
    const zonesLiees = this.getSiteZonesCount(id);
    this.openConfirm({
      title: 'Supprimer le site',
      message: zonesLiees > 0 ? `Le site <strong>"${nom}"</strong> possède <strong>${zonesLiees} zone(s)</strong> associée(s). Supprimer quand même ?` : `Êtes-vous sûr de vouloir supprimer le site <strong>"${nom}"</strong> ?`,
      confirmLabel: 'Supprimer', icon: '🏢', danger: true,
      onConfirm: () => {
        this.http.delete(`${this.API}/Sites/${id}`).subscribe({
          next: () => { this.sites = this.sites.filter(s => s.idSite !== id); this.totalSites = this.sites.length; this.showToast('Site supprimé', 'success'); },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ZONES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredZones(): Zone[] {
    return this.zones.filter(z => {
      const matchSearch = !this.searchZone || z.nom.toLowerCase().includes(this.searchZone.toLowerCase()) || (z.description ?? '').toLowerCase().includes(this.searchZone.toLowerCase());
      const matchSite   = !this.filtreZoneSite || String(z.siteId) === String(this.filtreZoneSite);
      return matchSearch && matchSite;
    });
  }

  getSiteNom(siteId: number): string { return this.sites.find(s => Number(s.idSite) === Number(siteId))?.nom ?? '—'; }
  getZoneEquipCount(zoneId: number): number { return this.equipements.filter(e => Number(e.zoneId) === Number(zoneId)).length; }

  openNewZone(): void { this.newZone = { nom: '', siteId: undefined, description: '' }; this.editingZone = null; this.showZoneModal = true; }

  editZone(zone: Zone): void {
    this.editingZone = { ...zone };
    this.newZone = { nom: zone.nom, siteId: zone.siteId, description: zone.description ?? '' };
    this.showZoneModal = true;
  }

  saveZone(): void {
    if (!this.newZone.nom?.trim()) { this.showToast('Le nom de la zone est requis', 'error'); return; }
    if (!this.newZone.siteId)     { this.showToast('Veuillez sélectionner un site', 'error'); return; }
    const payload = { ...this.newZone, siteId: Number(this.newZone.siteId) };
    const refreshZones = () => { this.http.get<Zone[]>(`${this.API}/Zones`).subscribe({ next: data => { this.zones = data || []; this.zonesCount = this.zones.length; } }); };
    if (this.editingZone) {
      this.http.put(`${this.API}/Zones/${this.editingZone.idZone}`, { ...this.editingZone, ...payload }).subscribe({
        next: () => { this.showZoneModal = false; this.editingZone = null; refreshZones(); this.showToast('Zone modifiée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Zone>(`${this.API}/Zones`, payload).subscribe({
        next: () => { this.showZoneModal = false; refreshZones(); this.showToast('Zone créée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteZone(id: number, nom: string): void {
    const equipsLies = this.getZoneEquipCount(id);
    this.openConfirm({
      title: 'Supprimer la zone',
      message: equipsLies > 0 ? `La zone <strong>"${nom}"</strong> contient <strong>${equipsLies} équipement(s)</strong>. Supprimer quand même ?` : `Êtes-vous sûr de vouloir supprimer la zone <strong>"${nom}"</strong> ?`,
      confirmLabel: 'Supprimer', icon: '📍', danger: true,
      onConfirm: () => {
        this.http.delete(`${this.API}/Zones/${id}`).subscribe({
          next: () => { this.zones = this.zones.filter(z => z.idZone !== id); this.zonesCount = this.zones.length; this.showToast('Zone supprimée', 'success'); },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ÉQUIPEMENTS — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredEquipements(): Equipement[] {
    return this.equipements.filter(e => {
      const zone = e.zone?.nom ?? '', type = e.typeEquipement ?? '';
      const matchZone   = this.filtreZone === 'Toutes les zones' || zone === this.filtreZone;
      const matchType   = this.filtreType === 'Tous les types'   || type === this.filtreType;
      const matchSearch = !this.searchEquipement || e.nom.toLowerCase().includes(this.searchEquipement.toLowerCase()) || type.toLowerCase().includes(this.searchEquipement.toLowerCase());
      return matchZone && matchType && matchSearch;
    });
  }

  get uniqueZones(): string[] { return ['Toutes les zones', ...new Set(this.equipements.map(e => e.zone?.nom ?? 'Sans zone'))]; }
  get uniqueTypes(): string[] { return ['Tous les types',   ...new Set(this.equipements.map(e => e.typeEquipement))]; }
  get totalTypes(): number    { return new Set(this.equipements.map(e => e.typeEquipement)).size; }

  getSiteFromZone(zoneId: number | undefined): string {
    if (!zoneId) return '—';
    const zone = this.zones.find(z => Number(z.idZone) === Number(zoneId));
    return zone ? this.getSiteNom(zone.siteId) : '—';
  }

  openNewEquipement(): void {
    this.newEquipement = { nom: '', typeEquipement: '', statut: 'actif', puissance: undefined, energieId: this.energies.length > 0 ? this.energies[0].idEnergie : undefined, zoneId: undefined, description: '' };
    this.editingEquipement = null; this.showEquipementModal = true;
  }

  editEquipement(eq: Equipement): void {
    this.editingEquipement = { ...eq };
    this.newEquipement = { nom: eq.nom, typeEquipement: eq.typeEquipement, statut: eq.statut, puissance: eq.puissance, energieId: eq.energieId, zoneId: eq.zoneId, description: eq.description };
    this.showEquipementModal = true;
  }

  saveEquipement(): void {
    if (!this.newEquipement.nom?.trim())            { this.showToast("Le nom de l'équipement est requis", 'error'); return; }
    if (!this.newEquipement.typeEquipement?.trim()) { this.showToast('Le type est requis', 'error'); return; }
    if (!this.newEquipement.energieId)              { this.showToast("Veuillez sélectionner un type d'énergie", 'error'); return; }
    const payload = { ...this.newEquipement, energieId: Number(this.newEquipement.energieId), zoneId: this.newEquipement.zoneId ? Number(this.newEquipement.zoneId) : null, puissance: this.newEquipement.puissance ? Number(this.newEquipement.puissance) : null };
    if (this.editingEquipement) {
      this.http.put(`${this.API}/Equipements/${this.editingEquipement.idEquipement}`, { ...this.editingEquipement, ...payload }).subscribe({
        next: () => { this.showEquipementModal = false; this.editingEquipement = null; this.reloadEquipements(); this.showToast('Équipement modifié avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Equipement>(`${this.API}/Equipements`, payload).subscribe({
        next: () => { this.showEquipementModal = false; this.reloadEquipements(); this.showToast('Équipement créé avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteEquipement(id: number, nom: string): void {
    this.openConfirm({
      title: 'Supprimer l\'équipement',
      message: `Êtes-vous sûr de vouloir supprimer l'équipement <strong>"${nom}"</strong> ? Les mesures associées pourraient être affectées.`,
      confirmLabel: 'Supprimer', icon: '🏭', danger: true,
      onConfirm: () => {
        this.http.delete(`${this.API}/Equipements/${id}`).subscribe({
          next: () => { this.equipements = this.equipements.filter(e => e.idEquipement !== id); this.totalEquipements = this.equipements.length; this.showToast('Équipement supprimé', 'success'); },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MESURES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredMesures(): Mesure[] {
    let result = [...this.mesures];
    if (this.mesureDateDebut || this.mesureDateFin) result = result.filter(m => this.dateInRange(m.dateMesure, this.mesureDateDebut, this.mesureDateFin));
    if (this.searchMesure) {
      const q = this.searchMesure.toLowerCase();
      result  = result.filter(m => (m.energie?.nom ?? '').toLowerCase().includes(q) || (m.sourceDonnee ?? '').toLowerCase().includes(q) || (m.equipement?.nom ?? '').toLowerCase().includes(q) || String(m.valeur).includes(q));
    }
    if      (this.sortMesure === 'Date — récent')        result.sort((a, b) => new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime());
    else if (this.sortMesure === 'Date — ancien')        result.sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    else if (this.sortMesure === 'Valeur — croissant')   result.sort((a, b) => a.valeur - b.valeur);
    else if (this.sortMesure === 'Valeur — décroissant') result.sort((a, b) => b.valeur - a.valeur);
    return result;
  }

  get paginatedMesures(): Mesure[] { const start = (this.mesuresPage - 1) * this.mesuresPerPage; return this.filteredMesures.slice(start, start + this.mesuresPerPage); }
  get totalMesuresPages(): number  { return Math.max(1, Math.ceil(this.filteredMesures.length / this.mesuresPerPage)); }

  openNewMesure(): void {
    this.newMesure = { valeur: 0, dateMesure: new Date().toISOString().slice(0, 16), sourceDonnee: '', energieId: this.energies.length > 0 ? this.energies[0].idEnergie : undefined, equipementId: undefined };
    this.editingMesure = null; this.showMesureModal = true;
  }

  editMesure(mesure: Mesure): void {
    this.editingMesure = { ...mesure };
    this.newMesure = { valeur: mesure.valeur, dateMesure: mesure.dateMesure ? mesure.dateMesure.slice(0, 16) : new Date().toISOString().slice(0, 16), sourceDonnee: mesure.sourceDonnee, energieId: mesure.energieId, equipementId: mesure.equipementId };
    this.showMesureModal = true;
  }

  saveMesure(): void {
    if (this.newMesure.valeur === undefined || this.newMesure.valeur === null) { this.showToast('La valeur est requise', 'error'); return; }
    if (!this.newMesure.energieId)            { this.showToast("Veuillez sélectionner un type d'énergie", 'error'); return; }
    if (!this.newMesure.sourceDonnee?.trim()) { this.showToast('La source de donnée est requise', 'error'); return; }
    const energie = this.energies.find(e => e.idEnergie === Number(this.newMesure.energieId));
    if (!energie) { this.showToast("Énergie introuvable, veuillez recharger la page", 'error'); return; }
    const payload = { valeur: Number(this.newMesure.valeur), dateMesure: this.newMesure.dateMesure ? new Date(this.newMesure.dateMesure).toISOString() : new Date().toISOString(), sourceDonnee: this.newMesure.sourceDonnee, energieNom: energie.nom, equipementId: this.newMesure.equipementId ? Number(this.newMesure.equipementId) : null };
    if (this.editingMesure) {
      this.http.put(`${this.API}/Mesures/${this.editingMesure.idMesure}`, payload).subscribe({
        next: () => {
          this.showMesureModal = false; this.editingMesure = null;
          this.reloadMesures();
          this.showToast('Mesure modifiée avec succès', 'success');
        },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Mesure>(`${this.API}/Mesures`, payload).subscribe({
        next: (created) => {
          this.showMesureModal = false;
          this.reloadMesures();
          // Vérifier si cette nouvelle mesure dépasse un seuil
          if (created) {
            const m = created as Mesure;
            this.verifierMesureContreSeuils(m);
          }
          this.showToast('Mesure créée avec succès', 'success');
        },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteMesure(id: number, valeur: number): void {
    this.openConfirm({
      title: 'Supprimer la mesure',
      message: `Supprimer la mesure de valeur <strong>${valeur}</strong> ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer', icon: '🔧', danger: true,
      onConfirm: () => {
        this.http.delete(`${this.API}/Mesures/${id}`).subscribe({
          next: () => { this.mesures = this.mesures.filter(m => m.idMesure !== id); this.refreshAfterChange(); this.showToast('Mesure supprimée', 'success'); },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  getNiveau(m: Mesure): 'Faible' | 'Normale' | 'Elevee' {
    const max = this.consommationMax || 1; const pct = (m.valeur / max) * 100;
    if (pct >= 80) return 'Elevee'; if (pct >= 40) return 'Normale'; return 'Faible';
  }
  getNiveauLabel(m: Mesure): string { return this.getNiveau(m); }
  niveauBarWidth(valeur: number):  number { return this.consommationMax ? Math.min((valeur / this.consommationMax) * 100, 100) : 0; }
  niveauBarClass(niveau: string):  string { if (niveau === 'Elevee') return 'red'; if (niveau === 'Normale') return 'amber'; return 'blue'; }
  niveauChipClass(niveau: string): string { if (niveau === 'Elevee') return 'chip chip--red'; if (niveau === 'Normale') return 'chip chip--amber'; return 'chip chip--blue'; }

  /** Indique si une mesure dépasse un seuil actif */
  mesureDepasseSeuil(m: Mesure): boolean {
    const seuil = this.seuils.find(s => s.energieId === m.energieId && s.actif);
    return !!seuil && m.valeur > seuil.valeurSeuil;
  }

  getSeuilPourMesure(m: Mesure): Seuil | null {
    return this.seuils.find(s => s.energieId === m.energieId && s.actif) ?? null;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ALERTES — LOGIQUE PRINCIPALE
  // ══════════════════════════════════════════════════════════════════════════════

  isAlerteActiveFromStatut(statut: string): boolean  { return isAlerteActive(statut); }
  isAlerteResolueFromStatut(statut: string): boolean { return isAlerteResolue(statut); }

  getStatutAlerteClass(statut: string): string {
    if (isAlerteResolue(statut)) return 'chip chip--green';
    return 'chip chip--red';
  }

  get filteredAlertes(): Alerte[] {
    return this.alertes.filter(a => {
      if (this.searchAlerte) {
        const q = this.searchAlerte.toLowerCase();
        const match =
          (a.type        ?? '').toLowerCase().includes(q) ||
          (a.message     ?? '').toLowerCase().includes(q) ||
          (a.energie?.nom     ?? '').toLowerCase().includes(q) ||
          (a.equipement?.nom  ?? '').toLowerCase().includes(q);
        if (!match) return false;
      }
      if (this.filtreAlerte === 'Actives'  && !isAlerteActive(a.statut))  return false;
      if (this.filtreAlerte === 'Résolues' && !isAlerteResolue(a.statut)) return false;
      if (!this.dateInRange(a.dateCreation ?? '', this.alerteDateDebut, this.alerteDateFin)) return false;
      return true;
    });
  }

  openNewAlerte(): void {
    this.newAlerte = { type: '', message: '', statut: 'active', energieId: undefined, equipementId: undefined };
    this.editingAlerte = null;
    this.showAlerteModal = true;
  }

  editAlerte(alerte: Alerte): void {
    this.editingAlerte = { ...alerte };
    this.newAlerte = { type: alerte.type, message: alerte.message, statut: alerte.statut, energieId: alerte.energieId, equipementId: alerte.equipementId };
    this.showAlerteModal = true;
  }

  saveAlerte(): void {
    if (!this.newAlerte.type?.trim())    { this.showToast('Le type est requis', 'error'); return; }
    if (!this.newAlerte.message?.trim()) { this.showToast('Le message est requis', 'error'); return; }
    if (this.editingAlerte) {
      const payload = { ...this.editingAlerte, ...this.newAlerte };
      this.http.put(`${this.API}/Alertes/${this.editingAlerte.idAlerte}`, payload).subscribe({
        next: () => { this.showAlerteModal = false; this.editingAlerte = null; this.reloadAlertes(); this.showToast('Alerte modifiée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Alerte>(`${this.API}/Alertes`, this.newAlerte).subscribe({
        next: () => { this.showAlerteModal = false; this.reloadAlertes(); this.showToast('Alerte créée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  toggleAlerteStatut(alerte: Alerte): void {
    const wasActive  = isAlerteActive(alerte.statut);
    const newStatut  = wasActive ? 'résolue' : 'active';
    const actionLabel = wasActive ? 'Résoudre' : 'Réactiver';
    this.openConfirm({
      title:        `${actionLabel} l'alerte`,
      message:      `Marquer l'alerte <strong>"${alerte.type}"</strong> comme <strong>${newStatut}</strong> ?`,
      confirmLabel: actionLabel,
      icon:         wasActive ? '✅' : '🔔',
      danger:       false,
      onConfirm: () => {
        const payload = { ...alerte, statut: newStatut };
        this.http.put(`${this.API}/Alertes/${alerte.idAlerte}`, payload).subscribe({
          next: () => {
            const idx = this.alertes.findIndex(a => a.idAlerte === alerte.idAlerte);
            if (idx !== -1) {
              this.alertes = [
                ...this.alertes.slice(0, idx),
                { ...this.alertes[idx], statut: newStatut },
                ...this.alertes.slice(idx + 1),
              ];
            }
            this.computeKPIs();
            this.showToast(`Alerte marquée "${newStatut}" ✅`, 'success');
          },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  deleteAlerte(id: number, type: string): void {
    const alerte = this.alertes.find(a => a.idAlerte === id);
    if (!alerte) { this.showToast('Alerte introuvable', 'error'); return; }
    this.openConfirm({
      title:        'Archiver l\'alerte',
      message:      `Archiver l'alerte <strong>"${type}"</strong> ? Elle sera conservée dans les archives et pourra être restaurée lors de cette session.`,
      confirmLabel: 'Archiver',
      icon:         '📦',
      danger:       false,
      onConfirm: () => {
        this.http.delete(`${this.API}/Alertes/${id}`).subscribe({
          next: () => {
            this.alertes = this.alertes.filter(a => a.idAlerte !== id);
            this.alertesArchivees.unshift({ ...alerte, archivedAt: new Date().toLocaleString('fr-FR') });
            this.computeKPIs();
            this.showToast('Alerte archivée 📦', 'success');
          },
          error: (e) => { this.showToast('Erreur archivage: ' + (e.error?.message || e.statusText), 'error'); }
        });
      }
    });
  }

  restoreAlerte(alerte: AlerteArchivee): void {
    this.openConfirm({
      title:        'Restaurer l\'alerte',
      message:      `Restaurer l'alerte <strong>"${alerte.type}"</strong> dans la liste active ?`,
      confirmLabel: 'Restaurer',
      icon:         '🔄',
      danger:       false,
      onConfirm: () => {
        const payload = { type: alerte.type, message: alerte.message, statut: alerte.statut, energieId: alerte.energieId ?? null, equipementId: alerte.equipementId ?? null };
        this.http.post<Alerte>(`${this.API}/Alertes`, payload).subscribe({
          next: () => { this.alertesArchivees = this.alertesArchivees.filter(a => a.idAlerte !== alerte.idAlerte); this.reloadAlertes(); this.showToast('Alerte restaurée ✅', 'success'); },
          error: (e) => this.showToast('Erreur restauration: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  supprimerDefinitivement(alerte: AlerteArchivee): void {
    this.openConfirm({
      title:        'Suppression définitive',
      message:      `Supprimer définitivement l'alerte <strong>"${alerte.type}"</strong> des archives ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      icon:         '🗑️',
      danger:       true,
      onConfirm: () => { this.alertesArchivees = this.alertesArchivees.filter(a => a.idAlerte !== alerte.idAlerte); this.showToast('Alerte supprimée définitivement', 'success'); }
    });
  }

  purgeArchives(): void {
    if (!this.alertesArchivees.length) return;
    this.openConfirm({
      title:        'Vider les archives',
      message:      `Effacer les <strong>${this.alertesArchivees.length} alerte(s)</strong> archivées de la mémoire de cette session ?`,
      confirmLabel: 'Tout vider',
      icon:         '🗑️',
      danger:       true,
      onConfirm: () => { this.alertesArchivees = []; this.showToast('Archives vidées', 'success'); }
    });
  }

  get filteredArchives(): AlerteArchivee[] {
    if (!this.searchArchive) return this.alertesArchivees;
    const q = this.searchArchive.toLowerCase();
    return this.alertesArchivees.filter(a =>
      (a.type            ?? '').toLowerCase().includes(q) ||
      (a.message         ?? '').toLowerCase().includes(q) ||
      (a.energie?.nom    ?? '').toLowerCase().includes(q) ||
      (a.equipement?.nom ?? '').toLowerCase().includes(q) ||
      (a.archivedAt      ?? '').toLowerCase().includes(q)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ÉNERGIES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  getEnergieEquipCount(energieId: number): number  { return this.equipements.filter(e => e.energieId === energieId).length; }
  getEnergieMesureCount(energieId: number): number { return this.mesures.filter(m => m.energieId === energieId).length; }
  getEnergieConsommation(energieId: number): number { return Math.round(this.mesures.filter(m => m.energieId === energieId).reduce((s, m) => s + (Number(m.valeur) || 0), 0) * 100) / 100; }

  get filteredEnergies(): Energie[] {
    if (!this.searchEnergie) return this.energies;
    const q = this.searchEnergie.toLowerCase();
    return this.energies.filter(e => e.nom.toLowerCase().includes(q) || e.unite.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q));
  }

  getEnergieIcon(nom: string): string {
    const n = normalizeStr(nom ?? '');
    if (n.includes('eau') || n.includes('water'))                            return '💧';
    if (n.includes('elec'))                                                  return '⚡';
    if (n.includes('gasoil') || n.includes('diesel') || n.includes('fioul') || n.includes('gaz')) return '🛢️';
    if (n.includes('solaire') || n.includes('solar'))                        return '☀️';
    return '⚡';
  }

  getEnergieColor(energie: Energie): string {
    if (energie.couleur) return energie.couleur;
    const n = normalizeStr(energie.nom ?? '');
    if (n.includes('eau') || n.includes('water'))                            return '#06b6d4';
    if (n.includes('elec'))                                                  return '#6366f1';
    if (n.includes('gasoil') || n.includes('diesel') || n.includes('fioul')) return '#f59e0b';
    if (n.includes('solaire'))                                               return '#eab308';
    return '#8b5cf6';
  }

  openNewEnergie(): void { this.newEnergie = { nom: '', unite: '', description: '', facteurConversion: 1, couleur: '#6366f1' }; this.editingEnergie = null; this.showEnergieModal = true; }

  editEnergie(energie: Energie): void {
    this.editingEnergie = { ...energie };
    this.newEnergie = { nom: energie.nom, unite: energie.unite, description: energie.description ?? '', facteurConversion: energie.facteurConversion ?? 1, couleur: energie.couleur ?? '#6366f1' };
    this.showEnergieModal = true;
  }

  saveEnergie(): void {
    if (!this.newEnergie.nom?.trim())   { this.showToast("Le nom de l'énergie est requis", 'error'); return; }
    if (!this.newEnergie.unite?.trim()) { this.showToast("L'unité est requise", 'error'); return; }
    const refreshEnergies = () => {
      this.http.get<Energie[]>(`${this.API}/Energies`).subscribe({ next: data => { this.energies = data || []; this.computeRepartition(); this.computeChartData(); this.initSeuilsFromEnergies(); } });
    };
    if (this.editingEnergie) {
      const payload: Energie = { idEnergie: this.editingEnergie.idEnergie, nom: this.newEnergie.nom!.trim(), unite: this.newEnergie.unite!.trim(), description: (this.newEnergie.description ?? '').trim() || undefined, facteurConversion: Number(this.newEnergie.facteurConversion) || 1, couleur: this.newEnergie.couleur ?? '#6366f1' };
      this.http.put<Energie>(`${this.API}/Energies/${this.editingEnergie.idEnergie}`, payload).subscribe({
        next: () => { this.showEnergieModal = false; this.editingEnergie = null; this.newEnergie = { nom: '', unite: '', description: '', facteurConversion: 1, couleur: '#6366f1' }; refreshEnergies(); this.showToast('Énergie modifiée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur modification énergie : ' + (e.error?.message || e.error?.title || e.statusText), 'error')
      });
    } else {
      const payload = { nom: this.newEnergie.nom!.trim(), unite: this.newEnergie.unite!.trim(), description: (this.newEnergie.description ?? '').trim() || null, facteurConversion: Number(this.newEnergie.facteurConversion) || 1, couleur: this.newEnergie.couleur ?? '#6366f1' };
      this.http.post<Energie>(`${this.API}/Energies`, payload).subscribe({
        next: () => { this.showEnergieModal = false; this.newEnergie = { nom: '', unite: '', description: '', facteurConversion: 1, couleur: '#6366f1' }; refreshEnergies(); this.showToast('Énergie créée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur création énergie : ' + (e.error?.message || e.error?.title || e.statusText), 'error')
      });
    }
  }

  deleteEnergie(id: number): void {
    const energie = this.energies.find(e => e.idEnergie === id);
    const nomEnergie = energie?.nom ?? `ID ${id}`;
    const linked = this.equipements.filter(e => e.energieId === id).length;
    this.openConfirm({
      title: 'Supprimer l\'énergie',
      message: linked > 0 ? `L'énergie <strong>"${nomEnergie}"</strong> est liée à <strong>${linked} équipement(s)</strong>. Supprimer quand même ?` : `Êtes-vous sûr de vouloir supprimer l'énergie <strong>"${nomEnergie}"</strong> ?`,
      confirmLabel: 'Supprimer', icon: '⚡', danger: true,
      onConfirm: () => {
        this.http.delete(`${this.API}/Energies/${id}`).subscribe({
          next: () => {
            this.energies = this.energies.filter(e => e.idEnergie !== id);
            // Supprimer aussi le seuil lié localement
            this.seuils = this.seuils.filter(s => s.energieId !== id);
            this.computeRepartition(); this.computeChartData();
            this.showToast(`Énergie "${nomEnergie}" supprimée`, 'success');
          },
          error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SEUILS — GESTION COMPLÈTE
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Initialise les seuils depuis les énergies disponibles.
   * Un seuil par énergie, créé localement s'il n'existe pas encore en base.
   */
  initSeuilsFromEnergies(): void {
    if (!this.energies.length) return;
    // Pour chaque énergie, s'il n'y a pas encore de seuil on en crée un vide
    this.energies.forEach(e => {
      const exists = this.seuils.find(s => s.energieId === e.idEnergie);
      if (!exists) {
        this.seuils.push({
          energieId:    e.idEnergie,
          energieNom:   e.nom,
          energieUnite: e.unite,
          valeurSeuil:  0,
          periode:      'Mensuel',
          actif:        false,
          couleur:      this.getEnergieColor(e),
          consommationActuelle: this.getEnergieConsommation(e.idEnergie),
          depassement:  false,
          pct:          0,
        });
      } else {
        // Mettre à jour le nom/unité si l'énergie a changé
        exists.energieNom   = e.nom;
        exists.energieUnite = e.unite;
        exists.couleur      = this.getEnergieColor(e);
      }
    });
    this.syncSeuilsConsommation();
  }

  /**
   * Recharge les seuils depuis l'API /Seuils (si elle existe),
   * sinon conserve les seuils locaux.
   */
  reloadSeuilsData(): void {
    this.http.get<any[]>(`${this.API}/Seuils`).subscribe({
      next: (data) => {
        if (!data?.length) { this.syncSeuilsConsommation(); return; }
        // Mapper les seuils API → format local
        data.forEach(s => {
          const energieId = s.energieId ?? s.EnergieId ?? 0;
          const idx       = this.seuils.findIndex(x => x.energieId === energieId);
          const energie   = this.energies.find(e => e.idEnergie === energieId);
          const mapped: Seuil = {
            idSeuil:      s.idSeuil ?? s.IdSeuil,
            energieId,
            energieNom:   energie?.nom   ?? s.energieNom   ?? '',
            energieUnite: energie?.unite ?? s.energieUnite ?? '',
            valeurSeuil:  +(s.valeurSeuil ?? s.valeur ?? s.Valeur ?? 0),
            periode:      s.periode      ?? 'Mensuel',
            actif:        s.actif        ?? true,
            couleur:      energie ? this.getEnergieColor(energie) : '#6366f1',
          };
          if (idx >= 0) this.seuils[idx] = { ...this.seuils[idx], ...mapped };
          else          this.seuils.push(mapped);
        });
        this.syncSeuilsConsommation();
      },
      error: () => {
        // API /Seuils non disponible : on travaille en local uniquement
        this.syncSeuilsConsommation();
      }
    });
  }

  /** Recalcule la consommation actuelle et le dépassement pour chaque seuil */
  syncSeuilsConsommation(): void {
    this.seuils = this.seuils.map(s => {
      const conso = this.getConsommationPourSeuil(s);
      const dep   = s.actif && s.valeurSeuil > 0 && conso > s.valeurSeuil;
      const pct   = s.valeurSeuil > 0 ? Math.round((conso / s.valeurSeuil) * 100) : 0;
      return { ...s, consommationActuelle: conso, depassement: dep, pct };
    });
  }

  /**
   * Calcule la consommation selon la période du seuil.
   */
  private getConsommationPourSeuil(s: Seuil): number {
    const now   = new Date();
    const mesuresEnergie = this.mesures.filter(m => m.energieId === s.energieId);

    let debut: Date;
    switch (s.periode) {
      case 'Journalier':
        debut = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'Hebdomadaire':
        debut = new Date(now); debut.setDate(now.getDate() - 7);
        break;
      case 'Annuel':
        debut = new Date(now.getFullYear(), 0, 1);
        break;
      default: // Mensuel
        debut = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    return Math.round(
      mesuresEnergie
        .filter(m => new Date(m.dateMesure) >= debut)
        .reduce((sum, m) => sum + (Number(m.valeur) || 0), 0) * 100
    ) / 100;
  }

  /** Getters pour l'UI seuils */
  get filteredSeuils(): Seuil[] {
    let list = [...this.seuils];
    if (this.searchSeuil) {
      const q = this.searchSeuil.toLowerCase();
      list = list.filter(s => s.energieNom.toLowerCase().includes(q));
    }
    if (this.filtreSeuil === 'Actifs')    list = list.filter(s => s.actif);
    if (this.filtreSeuil === 'Dépassés')  list = list.filter(s => s.depassement);
    if (this.filtreSeuil === 'Inactifs')  list = list.filter(s => !s.actif);
    return list;
  }

  get seuilsActifs():   number { return this.seuils.filter(s => s.actif).length; }
  get seuilsDepasses(): number { return this.seuils.filter(s => s.depassement).length; }

  getSeuilPct(s: Seuil): number { return s.pct ?? 0; }

  getSeuilBarClass(s: Seuil): string {
    const pct = this.getSeuilPct(s);
    if (pct >= 100) return 'seuil-bar__fill--red';
    if (pct >= 80)  return 'seuil-bar__fill--amber';
    return 'seuil-bar__fill--green';
  }

  getSeuilStatusClass(s: Seuil): string {
    if (!s.actif)      return 'chip chip--gray';
    if (s.depassement) return 'chip chip--red';
    const pct = this.getSeuilPct(s);
    if (pct >= 80)     return 'chip chip--amber';
    return 'chip chip--green';
  }

  getSeuilStatusLabel(s: Seuil): string {
    if (!s.actif)      return 'Inactif';
    if (s.depassement) return '⚠ Dépassé';
    const pct = this.getSeuilPct(s);
    if (pct >= 80)     return '⚡ Proche';
    return '✓ Normal';
  }

  /** Ouvre le modal de création/édition d'un seuil */
  openNewSeuil(): void {
    this.newSeuil = {
      energieId:  this.energies.length ? this.energies[0].idEnergie : undefined,
      valeurSeuil: 0,
      periode:    'Mensuel',
      actif:      true,
    };
    this.editingSeuil    = null;
    this.showSeuilModal  = true;
  }

  editSeuil(s: Seuil): void {
    this.editingSeuil = { ...s };
    this.newSeuil = {
      energieId:   s.energieId,
      valeurSeuil: s.valeurSeuil,
      periode:     s.periode,
      actif:       s.actif,
    };
    this.showSeuilModal = true;
  }

  saveSeuil(): void {
    if (!this.newSeuil.energieId)    { this.showToast("Sélectionnez une énergie", 'error'); return; }
    if (!this.newSeuil.valeurSeuil || this.newSeuil.valeurSeuil <= 0) {
      this.showToast("La valeur seuil doit être > 0", 'error'); return;
    }

    this.seuilSaving = true;
    const energie = this.energies.find(e => e.idEnergie === Number(this.newSeuil.energieId));

    const seuilData: Seuil = {
      energieId:    Number(this.newSeuil.energieId),
      energieNom:   energie?.nom   ?? '',
      energieUnite: energie?.unite ?? '',
      valeurSeuil:  Number(this.newSeuil.valeurSeuil),
      periode:      this.newSeuil.periode ?? 'Mensuel',
      actif:        this.newSeuil.actif   ?? true,
      couleur:      energie ? this.getEnergieColor(energie) : '#6366f1',
    };

    // Payload pour l'API
    const payload = {
      energieId:   seuilData.energieId,
      valeurSeuil: seuilData.valeurSeuil,
      periode:     seuilData.periode,
      actif:       seuilData.actif,
    };

    if (this.editingSeuil?.idSeuil) {
      // Mise à jour via API
      this.http.put(`${this.API}/Seuils/${this.editingSeuil.idSeuil}`, payload).subscribe({
        next: (resp: any) => {
          seuilData.idSeuil = this.editingSeuil!.idSeuil;
          this._applySeuil(seuilData);
          this.seuilSaving = false; this.showSeuilModal = false;
          this.showToast('Seuil modifié avec succès ✅', 'success');
          this.verifierDepassementsSeuils();
        },
        error: () => {
          // Fallback local si API indisponible
          seuilData.idSeuil = this.editingSeuil!.idSeuil;
          this._applySeuil(seuilData);
          this.seuilSaving = false; this.showSeuilModal = false;
          this.showToast('Seuil modifié (local)', 'info');
          this.verifierDepassementsSeuils();
        }
      });
    } else {
      // Création via API
      this.http.post<any>(`${this.API}/Seuils`, payload).subscribe({
        next: (resp: any) => {
          seuilData.idSeuil = resp?.idSeuil ?? resp?.IdSeuil ?? Date.now();
          this._applySeuil(seuilData);
          this.seuilSaving = false; this.showSeuilModal = false;
          this.showToast('Seuil créé avec succès ✅', 'success');
          this.verifierDepassementsSeuils();
        },
        error: () => {
          // Fallback local si API indisponible
          seuilData.idSeuil = Date.now();
          this._applySeuil(seuilData);
          this.seuilSaving = false; this.showSeuilModal = false;
          this.showToast('Seuil créé (local)', 'info');
          this.verifierDepassementsSeuils();
        }
      });
    }
  }

  /** Applique un seuil dans la liste locale */
  private _applySeuil(s: Seuil): void {
    const idx = this.seuils.findIndex(x => x.energieId === s.energieId);
    if (idx >= 0) this.seuils[idx] = { ...this.seuils[idx], ...s };
    else          this.seuils.push(s);
    this.seuils = [...this.seuils];
    this.syncSeuilsConsommation();
  }

  deleteSeuil(s: Seuil): void {
    this.openConfirm({
      title:        'Supprimer le seuil',
      message:      `Supprimer le seuil pour <strong>"${s.energieNom}"</strong> (${s.valeurSeuil} ${s.energieUnite}) ? Les alertes automatiques liées seront désactivées.`,
      confirmLabel: 'Supprimer',
      icon:         '📊',
      danger:       true,
      onConfirm: () => {
        const doDelete = () => {
          const idx = this.seuils.findIndex(x => x.energieId === s.energieId);
          if (idx >= 0) {
            // Réinitialiser plutôt que supprimer (on garde l'énergie)
            this.seuils[idx] = { ...this.seuils[idx], valeurSeuil: 0, actif: false, idSeuil: undefined, depassement: false, pct: 0 };
            this.seuils = [...this.seuils];
          }
          this.showToast('Seuil supprimé', 'success');
        };

        if (s.idSeuil) {
          this.http.delete(`${this.API}/Seuils/${s.idSeuil}`).subscribe({
            next:  () => doDelete(),
            error: () => { doDelete(); /* fallback local */ }
          });
        } else {
          doDelete();
        }
      }
    });
  }

  toggleSeuilActif(s: Seuil): void {
    const newActif = !s.actif;
    const idx = this.seuils.findIndex(x => x.energieId === s.energieId);
    if (idx >= 0) {
      this.seuils[idx] = { ...this.seuils[idx], actif: newActif };
      this.seuils = [...this.seuils];
      this.syncSeuilsConsommation();
    }
    if (s.idSeuil) {
      this.http.put(`${this.API}/Seuils/${s.idSeuil}`, { ...s, actif: newActif }).subscribe({
        error: () => {} // silencieux, l'état local est déjà mis à jour
      });
    }
    this.showToast(newActif ? 'Seuil activé ✅' : 'Seuil désactivé', 'info');
    if (newActif) this.verifierDepassementsSeuils();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // VÉRIFICATION DÉPASSEMENTS → ALERTES AUTOMATIQUES
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Vérifie tous les seuils actifs et crée des alertes automatiques
   * pour chaque dépassement non encore signalé.
   */
  verifierDepassementsSeuils(): void {
    this.syncSeuilsConsommation();

    const seuilsDepasses = this.seuils.filter(s => s.actif && s.depassement);
    if (!seuilsDepasses.length) return;

    seuilsDepasses.forEach(s => {
      // Vérifier si une alerte active existe déjà pour ce seuil/énergie
      const alerteExistante = this.alertes.find(a =>
        isAlerteActive(a.statut) &&
        a.energieId === s.energieId &&
        a.type === 'Dépassement de seuil'
      );

      if (!alerteExistante) {
        this.creerAlerteDepassement(s);
      }
    });
  }

  /**
   * Crée une alerte automatique lors du dépassement d'un seuil.
   */
  private creerAlerteDepassement(s: Seuil): void {
    const pct     = this.getSeuilPct(s);
    const ecart   = Math.round(((s.consommationActuelle ?? 0) - s.valeurSeuil) * 100) / 100;
    const payload = {
      type:       'Dépassement de seuil',
      message:    `⚠️ La consommation ${s.energieNom} (${s.periode.toLowerCase()}) dépasse le seuil fixé : ${s.consommationActuelle} ${s.energieUnite} relevés vs ${s.valeurSeuil} ${s.energieUnite} autorisés (+${ecart} ${s.energieUnite}, soit ${pct}% du seuil).`,
      statut:     'active',
      energieId:  s.energieId,
    };

    this.http.post<Alerte>(`${this.API}/Alertes`, payload).subscribe({
      next: (alerte) => {
        this.alertes = [alerte, ...this.alertes];
        this.computeKPIs();
        this.showToast(`🔔 Alerte créée : dépassement seuil ${s.energieNom}`, 'error');
      },
      error: () => {
        // Fallback : alerte locale si l'API échoue
        const alerteLocale: Alerte = {
          idAlerte:    Date.now(),
          type:        'Dépassement de seuil',
          message:     payload.message,
          statut:      'active',
          dateCreation: new Date().toISOString(),
          energieId:   s.energieId,
          energie:     { idEnergie: s.energieId, nom: s.energieNom },
        };
        this.alertes = [alerteLocale, ...this.alertes];
        this.computeKPIs();
        this.showToast(`🔔 Alerte locale : dépassement seuil ${s.energieNom}`, 'error');
      }
    });
  }

  /**
   * Vérifie si une mesure unique dépasse un seuil actif.
   * Appelé à la création d'une nouvelle mesure.
   */
  verifierMesureContreSeuils(m: Mesure): void {
    const seuil = this.seuils.find(s => s.energieId === m.energieId && s.actif && s.valeurSeuil > 0);
    if (!seuil) return;

    // Recalculer la conso après ajout
    setTimeout(() => {
      this.syncSeuilsConsommation();
      const seuilMisAJour = this.seuils.find(s => s.energieId === m.energieId);
      if (seuilMisAJour?.depassement) {
        this.verifierDepassementsSeuils();
      }
    }, 500);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PROFIL / MOT DE PASSE
  // ══════════════════════════════════════════════════════════════════════════════

  savePassword(): void {
    if (!this.motDePasseActuel || !this.nouveauMotDePasse || !this.confirmerMotDePasse) { this.showToast('Veuillez remplir tous les champs', 'error'); return; }
    if (this.nouveauMotDePasse.length < 6) { this.showToast('Le mot de passe doit avoir au moins 6 caractères', 'error'); return; }
    if (this.nouveauMotDePasse !== this.confirmerMotDePasse) { this.showToast('Les mots de passe ne correspondent pas', 'error'); return; }
    const user = this.auth.getCurrentUser();
    if (!user) return;
    this.http.post(`${this.API}/Auth/reset-password`, { email: user.email, code: this.motDePasseActuel, newPassword: this.nouveauMotDePasse }).subscribe({
      next: () => { this.showToast('Mot de passe modifié avec succès !', 'success'); this.motDePasseActuel = this.nouveauMotDePasse = this.confirmerMotDePasse = ''; },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // IA
  // ══════════════════════════════════════════════════════════════════════════════

  async sendIaMessage(text?: string): Promise<void> {
    const msg = text || this.iaInput.trim();
    if (!msg || this.iaLoading) return;
    this.iaInput   = '';
    this.iaLoading = true;
    this.iaTotalQuestions++;
    this.iaMessages.push({ role: 'user', content: msg, timestamp: this.currentTime });
    this.iaTotalMessages++;
    this.shouldScrollChat = true;

    if (isAdminSocialMessage(msg)) {
      const normalized = msg.trim().toLowerCase().replace(/[!.,?]/g, '');
      const response   = ADMIN_SOCIAL_RESPONSES[normalized] ?? 'De rien ! Je suis disponible pour toute question sur la plateforme. 😊';
      this.iaMessages.push({ role: 'assistant', content: response, timestamp: this.currentTime });
      this.iaTotalMessages++;
      this.iaLoading = false; this.shouldScrollChat = true;
      return;
    }

    try {
      const response = await fetch(`${this.RAG_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: msg, context: this.iaContext }) });
      if (!response.ok) throw new Error(`FastAPI: ${response.status}`);
      const data = await response.json();
      this.iaMessages.push({ role: 'assistant', content: data.response?.trim() ?? "Désolé, je n'ai pas pu traiter votre demande.", timestamp: this.currentTime });
      this.iaTotalMessages++;
    } catch {
      try {
        const response = await fetch(this.ollamaUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.ollamaModel, prompt: `${this.iaContext}\n\nQuestion: ${msg}`, stream: false }) });
        if (!response.ok) throw new Error(`Ollama: ${response.status}`);
        const data = await response.json();
        this.iaMessages.push({ role: 'assistant', content: data.response?.trim() ?? "Désolé, je n'ai pas pu traiter votre demande.", timestamp: this.currentTime });
        this.iaTotalMessages++;
      } catch {
        this.iaMessages.push({ role: 'assistant', content: 'Impossible de joindre le service IA. Vérifiez que FastAPI et Ollama tournent.', timestamp: this.currentTime });
        this.iaTotalMessages++;
      }
    }
    this.iaLoading = false; this.shouldScrollChat = true;
  }

  clearIaChat(): void {
    if (!this.iaMessages.length) return;
    this.openConfirm({
      title: 'Effacer la conversation', message: 'Effacer toute la conversation ? Cette action est irréversible.',
      confirmLabel: 'Effacer', icon: '🤖', danger: true,
      onConfirm: () => { this.iaMessages = []; this.iaTotalMessages = 0; this.iaTotalQuestions = 0; }
    });
  }

  exportIaChat(): void {
    if (!this.iaMessages.length) { this.showToast('Aucune conversation à exporter', 'info'); return; }
    const text = this.iaMessages.map(m => `[${m.timestamp}] ${m.role === 'user' ? 'Vous' : 'IA'}: ${m.content}`).join('\n\n');
    this.downloadFile(text, `ia-conversation-${new Date().toISOString().split('T')[0]}.txt`, 'text/plain');
    this.showToast('Conversation exportée', 'success');
  }

  iaKeydown(e: KeyboardEvent): void { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendIaMessage(); } }

  get iaContext(): string {
    const top3 = [...this.mesures].sort((a, b) => b.valeur - a.valeur).slice(0, 3).map(m => `${m.equipement?.nom ?? 'N/A'} (${m.valeur} ${m.energie?.unite ?? ''})`).join(', ');
    const energiesSummary = this.energies.map(e => `${e.nom} (${e.unite}) — ${this.getEnergieMesureCount(e.idEnergie)} mesures, conso: ${this.getEnergieConsommation(e.idEnergie)}`).join('; ');
    const repartitionStr  = this.repartitionEnergies.map(r => `${r.nom} ${r.pct}%`).join(', ') || 'N/A';
    const seuilsStr       = this.seuils.filter(s => s.actif).map(s => `${s.energieNom}: seuil ${s.valeurSeuil} ${s.energieUnite} (${s.periode}), conso actuelle ${s.consommationActuelle ?? 0} ${s.energieUnite}${s.depassement ? ' ⚠️ DÉPASSÉ' : ''}`).join('; ') || 'Aucun seuil actif';
    return `Tu es un assistant IA expert en gestion energetique pour la plateforme WICMIC TriPower.
Donnees TEMPS REEL (${new Date().toLocaleDateString('fr-FR')}) :
- Sites industriels : ${this.totalSites}
- Equipements actifs : ${this.totalEquipements} (en ligne: ${this.equipementsEnLigne}, maintenance: ${this.equipementsEnMaintenance})
- Total mesures : ${this.mesures.length} (cette semaine: ${this.mesuresCetteSemaine})
- Consommation totale : ${this.consommationTotale}
- Consommation aujourd'hui : ${this.consommationAujourdhui}
- Consommation moyenne : ${this.consommationMoyenne}
- Maximum releve : ${this.consommationMax}
- Minimum releve : ${this.consommationMin}
- Alertes actives : ${this.alertesActives} (nouvelles aujourd'hui: ${this.alertesAujourdhui})
- Alertes resolues : ${this.alertesResolues}
- Alertes archivees : ${this.alertesArchivees.length}
- Sante systeme : ${this.santeSysteme}% (objectif: ${this.objectifSante}%)
- Utilisateurs : ${this.totalUtilisateurs}
- Repartition energies : ${repartitionStr}
- Top 3 consommateurs : ${top3 || 'N/A'}
- Energies configurees (${this.energies.length}) : ${energiesSummary || 'N/A'}
- Seuils actifs (${this.seuilsActifs}) : ${seuilsStr}
- Depassements seuils : ${this.seuilsDepasses}
Reponds en francais, de maniere concise, professionnelle et structuree avec des bullet points si pertinent.`;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // EXCEL EXPORT
  // ══════════════════════════════════════════════════════════════════════════════

  private async loadSheetJS(): Promise<any> {
    if (typeof (window as any).XLSX !== 'undefined') return (window as any).XLSX;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload  = () => (window as any).XLSX ? resolve((window as any).XLSX) : reject(new Error('SheetJS introuvable'));
      script.onerror = () => reject(new Error('Impossible de charger SheetJS'));
      document.head.appendChild(script);
    });
  }

  private async writeExcel(rows: any[][], sheetName: string, filename: string): Promise<void> {
    const XLSX = await this.loadSheetJS();
    const ws   = XLSX.utils.aoa_to_sheet(rows);
    const maxCols = rows[0]?.length ?? 0;
    ws['!cols'] = Array.from({ length: maxCols }, (_, ci) => {
      const maxLen = Math.min(40, Math.max(...rows.map(r => String(r[ci] ?? '').length), String(rows[0][ci] ?? '').length));
      return { wch: maxLen + 2 };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  }

  async exportMesuresExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      const data = this.filteredMesures;
      const dateRange = this.mesureDateDebut || this.mesureDateFin ? ` (${this.mesureDateDebut || '…'} → ${this.mesureDateFin || '…'})` : '';
      const rows: any[][] = [
        ['#', 'Valeur', 'Unité', 'Énergie', 'Niveau', 'Source', 'Équipement', 'Date mesure', 'Dépassement seuil'],
        ...data.map((m, i) => [
          i + 1, m.valeur, m.energie?.unite ?? '', m.energie?.nom ?? '',
          this.getNiveauLabel(m), m.sourceDonnee, m.equipement?.nom ?? '',
          this.formatDate(m.dateMesure),
          this.mesureDepasseSeuil(m) ? `⚠ Oui (seuil: ${this.getSeuilPourMesure(m)?.valeurSeuil ?? '—'})` : 'Non'
        ])
      ];
      await this.writeExcel(rows, 'Mesures', `wicmic-mesures${dateRange}.xlsx`);
      this.showToast(`Excel mesures exporté (${data.length} lignes)`, 'success');
    } catch { this.showToast('Erreur export Excel', 'error'); }
    this.exportingExcel = false;
  }

  async exportSeuilsExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      const rows: any[][] = [
        ['Énergie', 'Unité', 'Seuil', 'Période', 'Conso. actuelle', 'Dépassement', '% utilisé', 'Statut'],
        ...this.seuils.map(s => [
          s.energieNom, s.energieUnite, s.valeurSeuil, s.periode,
          s.consommationActuelle ?? 0,
          s.depassement ? 'Oui' : 'Non',
          `${this.getSeuilPct(s)}%`,
          this.getSeuilStatusLabel(s)
        ])
      ];
      await this.writeExcel(rows, 'Seuils', 'wicmic-seuils.xlsx');
      this.showToast('Excel seuils exporté', 'success');
    } catch { this.showToast('Erreur export Excel', 'error'); }
    this.exportingExcel = false;
  }

  async exportAlertesExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      const data = this.filteredAlertes;
      const rows: any[][] = [['#', 'Type', 'Message', 'Statut', 'Énergie', 'Équipement', 'Date création'], ...data.map((a, i) => [i + 1, a.type, a.message, a.statut, a.energie?.nom ?? '', a.equipement?.nom ?? '', this.formatDate(a.dateCreation)])];
      await this.writeExcel(rows, 'Alertes', `wicmic-alertes.xlsx`);
      this.showToast(`Excel alertes exporté (${data.length} lignes)`, 'success');
    } catch { this.showToast('Erreur export Excel', 'error'); }
    this.exportingExcel = false;
  }

  async exportArchivesExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      if (!this.alertesArchivees.length) { this.showToast('Aucune archive à exporter', 'info'); this.exportingExcel = false; return; }
      const rows: any[][] = [['#', 'Type', 'Message', 'Statut', 'Énergie', 'Équipement', 'Date création', 'Archivée le'], ...this.alertesArchivees.map((a, i) => [i + 1, a.type, a.message, a.statut, a.energie?.nom ?? '', a.equipement?.nom ?? '', this.formatDate(a.dateCreation), a.archivedAt])];
      await this.writeExcel(rows, 'Archives', `wicmic-archives-alertes.xlsx`);
      this.showToast(`Excel archives exporté (${this.alertesArchivees.length} lignes)`, 'success');
    } catch { this.showToast('Erreur export Excel archives', 'error'); }
    this.exportingExcel = false;
  }

  async exportEquipementsExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      const rows: any[][] = [['ID', 'Nom', 'Type', 'Site', 'Zone', 'Énergie', 'Puissance (W)', 'Statut'], ...this.equipements.map(e => [e.idEquipement, e.nom, e.typeEquipement, this.getSiteFromZone(e.zoneId), e.zone?.nom ?? '', e.energie?.nom ?? '', e.puissance ?? '', e.statut])];
      await this.writeExcel(rows, 'Équipements', 'wicmic-equipements.xlsx');
      this.showToast('Excel équipements exporté', 'success');
    } catch { this.showToast('Erreur export Excel', 'error'); }
    this.exportingExcel = false;
  }

  async exportEnergiesExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      const rows: any[][] = [['ID', 'Nom', 'Unité', 'Description', 'Facteur conv.', 'Équipements', 'Mesures', 'Conso. totale'], ...this.energies.map(e => [e.idEnergie, e.nom, e.unite, e.description ?? '', e.facteurConversion ?? 1, this.getEnergieEquipCount(e.idEnergie), this.getEnergieMesureCount(e.idEnergie), this.getEnergieConsommation(e.idEnergie)])];
      await this.writeExcel(rows, 'Énergies', 'wicmic-energies.xlsx');
      this.showToast('Excel énergies exporté', 'success');
    } catch { this.showToast('Erreur export Excel', 'error'); }
    this.exportingExcel = false;
  }

  async exportSyntheseExcel(): Promise<void> {
    this.exportingExcel = true;
    try {
      const XLSX = await this.loadSheetJS(); const wb = XLSX.utils.book_new(); const now = new Date().toLocaleDateString('fr-FR');
      const kpiRows: any[][] = [
        ['Rapport WICMIC TriPower', '', `Généré le ${now}`], [],
        ['INDICATEUR', 'VALEUR', 'STATUT'],
        ['Sites', this.totalSites, '✅'], ['Zones', this.zonesCount, '✅'], ['Équipements', this.totalEquipements, '✅'],
        ['Équipements en ligne', this.equipementsEnLigne, '✅'], ['Équipements en maintenance', this.equipementsEnMaintenance, this.equipementsEnMaintenance > 0 ? '⚠️' : '✅'], ['Équipements dégradés', this.equipementsDegrades, this.equipementsDegrades > 0 ? '⚠️' : '✅'],
        ['Mesures (total)', this.totalMesures, '✅'], ['Mesures cette semaine', this.mesuresCetteSemaine, '✅'], ['Variation mesures vs sem. passée', `${this.variationMesures}%`, this.variationMesures >= 0 ? '↑' : '↓'],
        ['Alertes actives', this.alertesActives, this.alertesActives > 0 ? '⚠️' : '✅'], ['Alertes nouvelles aujourd\'hui', this.alertesAujourdhui, this.alertesAujourdhui > 0 ? '⚠️' : '✅'], ['Alertes résolues', this.alertesResolues, '✅'], ['Alertes archivées', this.alertesArchivees.length, '📦'],
        ['Utilisateurs', this.totalUtilisateurs, '✅'], ['Conso. totale', this.consommationTotale, '—'], ['Conso. aujourd\'hui', this.consommationAujourdhui, '—'], ['Conso. hier', this.consommationHier, '—'], ['Variation conso. vs hier', `${this.variationConso}%`, this.variationConso <= 0 ? '✅' : '⚠️'],
        ['Conso. moyenne', this.consommationMoyenne, '—'], ['Maximum relevé', this.consommationMax, '—'], ['Minimum relevé', this.consommationMin, '—'],
        ['Santé système (%)', this.santeSysteme, this.santeSysteme >= this.objectifSante ? '✅' : '⚠️'], ['Objectif santé (%)', this.objectifSante, '—'], [],
        ['RÉPARTITION ÉNERGÉTIQUE'], ['Énergie', 'Part (%)'], ...this.repartitionEnergies.map(r => [r.nom, r.pct]),
        [], ['SEUILS'], ['Énergie', 'Seuil', 'Période', 'Conso. actuelle', 'Statut'],
        ...this.seuils.filter(s => s.actif).map(s => [s.energieNom, `${s.valeurSeuil} ${s.energieUnite}`, s.periode, `${s.consommationActuelle ?? 0} ${s.energieUnite}`, this.getSeuilStatusLabel(s)]),
      ];
      const wsKpi = XLSX.utils.aoa_to_sheet(kpiRows); wsKpi['!cols'] = [{ wch: 35 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsKpi, 'Synthèse');
      const meRows: any[][] = [['#', 'Valeur', 'Unité', 'Énergie', 'Niveau', 'Source', 'Équipement', 'Date', 'Dépassement'], ...this.filteredMesures.map((m, i) => [i+1, m.valeur, m.energie?.unite ?? '', m.energie?.nom ?? '', this.getNiveauLabel(m), m.sourceDonnee, m.equipement?.nom ?? '', this.formatDate(m.dateMesure), this.mesureDepasseSeuil(m) ? '⚠ Oui' : 'Non'])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meRows), 'Mesures');
      const alRows: any[][] = [['#', 'Type', 'Message', 'Statut', 'Énergie', 'Équipement', 'Date création'], ...this.filteredAlertes.map((a, i) => [i+1, a.type, a.message, a.statut, a.energie?.nom ?? '', a.equipement?.nom ?? '', this.formatDate(a.dateCreation)])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(alRows), 'Alertes');
      const seuRows: any[][] = [['Énergie', 'Unité', 'Seuil', 'Période', 'Conso. actuelle', 'Dépassement', '% utilisé'], ...this.seuils.map(s => [s.energieNom, s.energieUnite, s.valeurSeuil, s.periode, s.consommationActuelle ?? 0, s.depassement ? 'Oui' : 'Non', `${this.getSeuilPct(s)}%`])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seuRows), 'Seuils');
      if (this.alertesArchivees.length > 0) {
        const archRows: any[][] = [['#', 'Type', 'Message', 'Statut', 'Énergie', 'Équipement', 'Date création', 'Archivée le'], ...this.alertesArchivees.map((a, i) => [i+1, a.type, a.message, a.statut, a.energie?.nom ?? '', a.equipement?.nom ?? '', this.formatDate(a.dateCreation), a.archivedAt])];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(archRows), 'Archives');
      }
      const siRows: any[][] = [['ID', 'Nom', 'Adresse', 'Description', 'Zones', 'Équipements'], ...this.sites.map(s => [s.idSite, s.nom, s.adresse ?? '', s.description ?? '', this.getSiteZonesCount(s.idSite), this.getSiteEquipCount(s.idSite)])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(siRows), 'Sites');
      const dateFile = `${String(new Date().getDate()).padStart(2,'0')}-${String(new Date().getMonth()+1).padStart(2,'0')}-${new Date().getFullYear()}`;
      XLSX.writeFile(wb, `wicmic-rapport-complet-${dateFile}.xlsx`);
      this.showToast('Rapport Excel complet exporté', 'success');
    } catch { this.showToast('Erreur export Excel', 'error'); }
    this.exportingExcel = false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PDF EXPORT — DISPATCHER
  // ══════════════════════════════════════════════════════════════════════════════

  async exportRapportPDF(type: string): Promise<void> {
    if (this.exportingPDF) return;
    this.exportingPDF = true;
    this.showToast(`Génération du PDF "${type}"...`, 'info');
    try {
      switch (type) {
        case 'mesures':      await this.exportPdfMesures();      break;
        case 'alertes':
        case 'Alertes':      await this.exportPdfAlertes();      break;
        case 'utilisateurs': await this.exportPdfUtilisateurs(); break;
        case 'equipements':  await this.exportPdfEquipements();  break;
        case 'energies':     await this.exportPdfEnergies();     break;
        case 'sites':        await this.exportPdfSites();        break;
        case 'seuils':       await this.exportPdfSeuils();       break;
        default:             await this.exportPdfSynthese();     break;
      }
    } catch (err) {
      console.error('Erreur PDF:', err);
      this.showToast('Erreur lors de la génération du PDF', 'error');
    }
    this.exportingPDF = false;
  }

  // ── PDF Seuils ───────────────────────────────────────────────────────────────

  private async exportPdfSeuils(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Seuils', margin);

    this.pdfTxt(doc, 'Rapport des Seuils de Consommation', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.seuilsActifs} seuil(s) actif(s)  |  ${this.seuilsDepasses} dépassement(s)`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.amber); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Seuils total',   value: String(this.seuils.length),        rgb: C.blue   },
      { label: 'Actifs',         value: String(this.seuilsActifs),          rgb: C.green  },
      { label: 'Dépassés',       value: String(this.seuilsDepasses),        rgb: this.seuilsDepasses > 0 ? C.red : C.green },
      { label: 'Alertes seuils', value: String(this.alertes.filter(a => a.type === 'Dépassement de seuil' && isAlerteActive(a.statut)).length), rgb: C.amber },
    ];
    const gap = 3, nCols = 4, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    kpis.forEach((kpi, i) => {
      this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb);
    });
    y += cardH + gap + 8;

    y = this.pdfSection(doc, 'ÉTAT DES SEUILS PAR ÉNERGIE', `${this.seuils.length} vecteur(s) surveillé(s)`, margin, y, usable, C.amber);

    // Barres de progression pour chaque seuil
    this.seuils.forEach(s => {
      const pct  = this.getSeuilPct(s);
      const rgb  = this.hexToRgb(s.couleur ?? '#6366f1') ?? C.blue;
      const colorBar = s.depassement ? C.red : pct >= 80 ? C.amber : C.green;

      this.pdfTxt(doc, `${s.energieNom} (${s.periode})`, margin, y + 4.5, C.textMain, 8, true);
      this.pdfTxt(doc, s.actif ? (s.depassement ? '⚠ DÉPASSÉ' : `${pct}%`) : 'INACTIF', margin + usable, y + 4.5, s.depassement ? C.red : C.textMuted, 7.5, true, 'right');
      y += 7;

      const barW = usable - 10;
      this.pdfRR(doc, margin, y, barW, 8, C.grayBg, 2);
      const filled = Math.min((pct / 100) * barW, barW);
      if (filled > 0 && s.actif) { this.pdfSetFill(doc, colorBar); doc.rect(margin, y, filled, 8, 'F'); }

      const infoText = s.actif
        ? `${s.consommationActuelle ?? 0} / ${s.valeurSeuil} ${s.energieUnite}`
        : 'Seuil non configuré';
      this.pdfTxt(doc, infoText, margin + barW + 3, y + 5.5, C.textMuted, 6.5);
      y += 14;
    });

    y += 4;
    y = this.pdfSection(doc, 'DÉTAIL DES SEUILS', '', margin, y, usable, C.red);
    const seuilH = [
      { title: 'ÉNERGIE',       w: 40 },
      { title: 'UNITÉ',         w: 18 },
      { title: 'SEUIL',         w: 25, align: 'center' as const },
      { title: 'PÉRIODE',       w: 28 },
      { title: 'CONSOMMATION',  w: 30, align: 'center' as const },
      { title: '% UTILISÉ',     w: 22, align: 'center' as const },
      { title: 'STATUT',        w: usable - 163, align: 'center' as const },
    ];
    const seuilR = this.seuils.map(s => {
      const pct     = this.getSeuilPct(s);
      const statRgb = s.depassement ? C.red : pct >= 80 ? C.amber : s.actif ? C.green : C.textMuted;
      return [
        { text: s.energieNom, bold: true },
        { text: s.energieUnite },
        { text: s.valeurSeuil > 0 ? String(s.valeurSeuil) : '—', align: 'center' as const },
        { text: s.periode },
        { text: String(s.consommationActuelle ?? 0), align: 'center' as const },
        { text: s.actif ? `${pct}%` : '—', align: 'center' as const },
        { text: this.getSeuilStatusLabel(s), badge: { rgb: statRgb } },
      ];
    });
    y = this.pdfTable(doc, seuilH, seuilR, margin, y, pageW, pageH, margin, 'Seuils', C.amber);

    this.pdfFinalize(doc, pageW, pageH, margin, 'seuils');
    this.showToast('PDF Seuils téléchargé !', 'success');
  }

  // ── PDF Mesures ──────────────────────────────────────────────────────────────

  private async exportPdfMesures(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Mesures', margin);
    this.pdfTxt(doc, 'Rapport des Mesures', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `Total : ${this.filteredMesures.length} mesures  |  Période : ${this.mesureDateDebut || '—'} → ${this.mesureDateFin || '—'}`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.amber); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Total mesures',    value: String(this.totalMesures),           rgb: C.blue   },
      { label: 'Cette semaine',    value: String(this.mesuresCetteSemaine),    rgb: C.indigo },
      { label: 'Conso. totale',    value: String(this.consommationTotale),     rgb: C.amber  },
      { label: 'Conso. moyenne',   value: String(this.consommationMoyenne),    rgb: C.cyan   },
      { label: 'Maximum relevé',   value: String(this.consommationMax),        rgb: C.red    },
      { label: 'Minimum relevé',   value: String(this.consommationMin),        rgb: C.green  },
      { label: 'Conso. auj.',      value: String(this.consommationAujourdhui), rgb: C.purple },
      { label: 'Variation vs hier',value: `${this.variationConso}%`,           rgb: this.variationConso <= 0 ? C.green : C.red },
    ];
    const gap = 3, nCols = 4, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    [0, 4].forEach(offset => {
      kpis.slice(offset, offset + nCols).forEach((kpi, i) => {
        this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb);
      });
      y += cardH + gap;
    });
    y += 6;

    y = this.pdfSection(doc, 'RÉPARTITION ÉNERGÉTIQUE', '', margin, y, usable, C.amber);
    const labelW = 30, pctW = 10, barW = usable - labelW - pctW - 4;
    this.repartitionEnergies.forEach(rep => {
      const rgb = this.hexToRgb(rep.couleur) ?? C.blue;
      this.pdfTxt(doc, rep.nom, margin, y + 4.5, C.textMain, 8, true);
      this.pdfBar(doc, margin + labelW, y, barW, rep.pct, rgb);
      this.pdfTxt(doc, `${rep.pct}%`, margin + labelW + barW + 3, y + 4.5, rgb, 7.5, true);
      y += 10;
    });
    y += 4;

    y = this.pdfSection(doc, 'DÉTAIL DES MESURES', `${Math.min(this.filteredMesures.length, 50)} premières`, margin, y, usable, C.amber);
    const nRgb = (m: Mesure): [number,number,number] => {
      const n = this.getNiveau(m);
      if (n === 'Elevee') return C.red;
      if (n === 'Normale') return C.amber;
      return C.blue;
    };
    const mesH = [
      { title: '#',          w: 8,  align: 'center' as const },
      { title: 'VALEUR',     w: 20 },
      { title: 'UNITÉ',      w: 14 },
      { title: 'ÉNERGIE',    w: 25 },
      { title: 'NIVEAU',     w: 18, align: 'center' as const },
      { title: 'SOURCE',     w: 25 },
      { title: 'ÉQUIPEMENT', w: 28 },
      { title: 'DATE',       w: 25 },
      { title: 'SEUIL',      w: usable - 163, align: 'center' as const },
    ];
    const mesR = [...this.filteredMesures]
      .sort((a, b) => new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime())
      .slice(0, 50)
      .map((m, i) => {
        const dep = this.mesureDepasseSeuil(m);
        return [
          { text: String(i + 1), align: 'center' as const },
          { text: String(m.valeur), bold: true },
          { text: m.energie?.unite ?? '—' },
          { text: m.energie?.nom ?? '—' },
          { text: this.getNiveauLabel(m), badge: { rgb: nRgb(m) } },
          { text: m.sourceDonnee ?? '—' },
          { text: m.equipement?.nom ?? '—' },
          { text: this.formatDateShort(m.dateMesure) },
          { text: dep ? '⚠' : '✓', badge: { rgb: dep ? C.red : C.green } },
        ];
      });
    y = this.pdfTable(doc, mesH, mesR, margin, y, pageW, pageH, margin, 'Mesures', C.amber);

    this.pdfFinalize(doc, pageW, pageH, margin, 'mesures');
    this.showToast('PDF Mesures téléchargé !', 'success');
  }

  // ── PDF Alertes ──────────────────────────────────────────────────────────────

  private async exportPdfAlertes(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Alertes', margin);
    this.pdfTxt(doc, 'Rapport des Alertes', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.alertesActives} active(s)  |  ${this.alertesResolues} résolue(s)  |  ${this.alertesArchivees.length} archivée(s)`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.red); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Total alertes',       value: String(this.alertes.length),         rgb: C.blue   },
      { label: 'Actives',             value: String(this.alertesActives),          rgb: this.alertesActives > 0 ? C.red : C.green },
      { label: 'Résolues',            value: String(this.alertesResolues),         rgb: C.green  },
      { label: 'Archivées',           value: String(this.alertesArchivees.length), rgb: C.amber  },
      { label: 'Aujourd\'hui',        value: String(this.alertesAujourdhui),       rgb: this.alertesAujourdhui > 0 ? C.red : C.green },
      { label: 'Alertes seuils',      value: String(this.alertes.filter(a => a.type === 'Dépassement de seuil').length), rgb: C.amber },
      { label: 'Santé système',       value: `${this.santeSysteme}%`,              rgb: this.santeSysteme >= this.objectifSante ? C.green : C.red },
    ];
    const gap = 3, nCols = 4, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    [0, 4].forEach(offset => {
      kpis.slice(offset, offset + Math.min(nCols, kpis.length - offset)).forEach((kpi, i) => {
        this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb);
      });
      y += cardH + gap;
    });
    y += 6;

    y = this.pdfSection(doc, 'ALERTES ACTIVES', `${this.alertes.filter(a => isAlerteActive(a.statut)).length} alerte(s)`, margin, y, usable, C.red);
    const alertActives = this.alertes.filter(a => isAlerteActive(a.statut));
    if (!alertActives.length) {
      this.pdfRR(doc, margin, y, usable, 10, C.green, 2);
      this.pdfTxt(doc, '✅ Aucune alerte active — Système nominal', pageW / 2, y + 7, C.white, 9, true, 'center');
      y += 15;
    } else {
      const alertH = [
        { title: 'TYPE',        w: 38 },
        { title: 'MESSAGE',     w: 80 },
        { title: 'ÉNERGIE',     w: 25 },
        { title: 'ÉQUIPEMENT',  w: 25 },
        { title: 'DATE',        w: usable - 168 },
      ];
      const alertR = alertActives.slice(0, 30).map(a => [
        { text: a.type ?? '—', bold: true },
        { text: a.message ?? '—' },
        { text: a.energie?.nom ?? '—' },
        { text: a.equipement?.nom ?? '—' },
        { text: this.formatDateShort(a.dateCreation) },
      ]);
      y = this.pdfTable(doc, alertH, alertR, margin, y, pageW, pageH, margin, 'Alertes', C.red);
    }

    this.pdfFinalize(doc, pageW, pageH, margin, 'alertes');
    this.showToast('PDF Alertes téléchargé !', 'success');
  }

  // ── PDF Utilisateurs ─────────────────────────────────────────────────────────

  private async exportPdfUtilisateurs(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Utilisateurs', margin);
    this.pdfTxt(doc, 'Rapport des Utilisateurs', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.totalUtilisateurs} compte(s) enregistré(s)`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.purple); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Total',          value: String(this.totalUtilisateurs), rgb: C.blue   },
      { label: 'Administrateurs',value: String(this.adminCount),        rgb: C.red    },
      { label: 'Responsables',   value: String(this.respCount),         rgb: C.indigo },
      { label: 'Employés',       value: String(this.empCount),          rgb: C.green  },
    ];
    const gap = 3, nCols = 4, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    kpis.forEach((kpi, i) => { this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb); });
    y += cardH + gap + 8;

    y = this.pdfSection(doc, 'LISTE DES UTILISATEURS', `${this.utilisateurs.length} compte(s)`, margin, y, usable, C.purple);
    const roleRgb = (role: string): [number,number,number] => {
      const r = role.toLowerCase();
      if (r.includes('admin'))       return C.red;
      if (r.includes('responsable')) return C.indigo;
      if (r.includes('employ'))      return C.green;
      return C.blue;
    };
    const userH = [
      { title: '#',     w: 10, align: 'center' as const },
      { title: 'NOM',   w: 55 },
      { title: 'EMAIL', w: 80 },
      { title: 'RÔLE',  w: usable - 145, align: 'center' as const },
    ];
    const userR = this.utilisateurs.map((u, i) => [
      { text: String(i + 1), align: 'center' as const },
      { text: u.nom, bold: true },
      { text: u.email },
      { text: this.getRoleLabel(u.role), badge: { rgb: roleRgb(u.role) } },
    ]);
    y = this.pdfTable(doc, userH, userR, margin, y, pageW, pageH, margin, 'Utilisateurs', C.purple);
    this.pdfFinalize(doc, pageW, pageH, margin, 'utilisateurs');
    this.showToast('PDF Utilisateurs téléchargé !', 'success');
  }

  // ── PDF Équipements ──────────────────────────────────────────────────────────

  private async exportPdfEquipements(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Équipements', margin);
    this.pdfTxt(doc, 'Rapport des Équipements', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.totalEquipements} équipement(s)  |  ${this.totalTypes} type(s)`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.cyan); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Total',        value: String(this.totalEquipements),         rgb: C.blue   },
      { label: 'En ligne',     value: String(this.equipementsEnLigne),       rgb: C.green  },
      { label: 'Maintenance',  value: String(this.equipementsEnMaintenance), rgb: this.equipementsEnMaintenance > 0 ? C.amber : C.green },
      { label: 'Hors ligne',   value: String(this.equipementsDegrades),      rgb: this.equipementsDegrades > 0 ? C.red : C.green },
      { label: 'Types',        value: String(this.totalTypes),               rgb: C.indigo },
      { label: 'Zones',        value: String(this.zonesCount),               rgb: C.purple },
    ];
    const gap = 3, nCols = 6, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    kpis.forEach((kpi, i) => { this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb); });
    y += cardH + gap + 8;

    y = this.pdfSection(doc, 'LISTE DES ÉQUIPEMENTS', `${this.equipements.length} équipement(s)`, margin, y, usable, C.cyan);
    const equipH = [
      { title: '#',          w: 10, align: 'center' as const },
      { title: 'NOM',        w: 48 },
      { title: 'TYPE',       w: 38 },
      { title: 'SITE',       w: 35 },
      { title: 'ZONE',       w: 30 },
      { title: 'ÉNERGIE',    w: 25 },
      { title: 'PUISSANCE',  w: 22, align: 'center' as const },
      { title: 'STATUT',     w: usable - 208, align: 'center' as const },
    ];
    const statutRgb = (s: string): [number,number,number] => {
      const st = s.toLowerCase();
      if (st.includes('actif') || st === 'on') return C.green;
      if (st.includes('maintenance'))           return C.amber;
      return C.red;
    };
    const equipR = this.equipements.map((e, i) => [
      { text: String(i + 1), align: 'center' as const },
      { text: e.nom, bold: true },
      { text: e.typeEquipement ?? '—' },
      { text: this.getSiteFromZone(e.zoneId) },
      { text: e.zone?.nom ?? '—' },
      { text: e.energie?.nom ?? '—' },
      { text: e.puissance ? `${e.puissance} W` : '—', align: 'center' as const },
      { text: e.statut ?? '—', badge: { rgb: statutRgb(e.statut ?? '') } },
    ]);
    y = this.pdfTable(doc, equipH, equipR, margin, y, pageW, pageH, margin, 'Équipements', C.cyan);
    this.pdfFinalize(doc, pageW, pageH, margin, 'equipements');
    this.showToast('PDF Équipements téléchargé !', 'success');
  }

  // ── PDF Énergies ─────────────────────────────────────────────────────────────

  private async exportPdfEnergies(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Énergies', margin);
    this.pdfTxt(doc, 'Rapport des Énergies', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.energies.length} vecteur(s) énergétique(s) configuré(s)`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.amber); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    y = this.pdfSection(doc, 'RÉPARTITION ÉNERGÉTIQUE', 'Part de chaque énergie', margin, y, usable, C.amber);
    const labelW = 30, barW = usable - labelW - 14;
    this.repartitionEnergies.forEach(rep => {
      const rgb = this.hexToRgb(rep.couleur) ?? C.blue;
      this.pdfTxt(doc, rep.nom, margin, y + 4.5, C.textMain, 8, true);
      this.pdfBar(doc, margin + labelW, y, barW, rep.pct, rgb);
      this.pdfTxt(doc, `${rep.pct}%`, margin + labelW + barW + 3, y + 4.5, rgb, 7.5, true);
      y += 10;
    });
    y += 6;

    y = this.pdfSection(doc, 'ÉVOLUTION MENSUELLE', '7 derniers mois', margin, y, usable, C.blue);
    this.pdfBarChart(doc, margin, y + 10, usable, 46); y += 64;

    y = this.pdfSection(doc, 'DÉTAIL PAR ÉNERGIE', '', margin, y, usable, C.indigo);
    const enH = [
      { title: 'NOM',          w: 32 },
      { title: 'UNITÉ',        w: 18 },
      { title: 'DESCRIPTION',  w: 48 },
      { title: 'ÉQUIPEMENTS',  w: 25, align: 'center' as const },
      { title: 'MESURES',      w: 20, align: 'center' as const },
      { title: 'CONSO. TOTALE',w: 25, align: 'center' as const },
      { title: 'SEUIL',        w: usable - 168, align: 'center' as const },
    ];
    const enR = this.energies.map(e => {
      const s   = this.seuils.find(x => x.energieId === e.idEnergie);
      const dep = s?.depassement;
      return [
        { text: e.nom, bold: true },
        { text: e.unite },
        { text: e.description ?? '—' },
        { text: String(this.getEnergieEquipCount(e.idEnergie)),   badge: { rgb: C.indigo } },
        { text: String(this.getEnergieMesureCount(e.idEnergie)),  badge: { rgb: C.blue   } },
        { text: String(this.getEnergieConsommation(e.idEnergie)), badge: { rgb: C.amber  } },
        { text: s?.actif ? `${s.valeurSeuil} ${s.energieUnite}${dep ? ' ⚠' : ''}` : '—', badge: dep ? { rgb: C.red } : undefined },
      ];
    });
    y = this.pdfTable(doc, enH, enR, margin, y, pageW, pageH, margin, 'Énergies', C.amber);
    this.pdfFinalize(doc, pageW, pageH, margin, 'energies');
    this.showToast('PDF Énergies téléchargé !', 'success');
  }

  // ── PDF Sites ────────────────────────────────────────────────────────────────

  private async exportPdfSites(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;

    this.pdfPageHeader(doc, pageW, pageH, 'Sites & Zones', margin);
    this.pdfTxt(doc, 'Rapport Sites & Zones', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.totalSites} site(s)  |  ${this.zonesCount} zone(s)`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.blue); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Sites',           value: String(this.totalSites),           rgb: C.blue   },
      { label: 'Zones',           value: String(this.zonesCount),           rgb: C.indigo },
      { label: 'Sites avec zones',value: String(this.sitesAvecZones),       rgb: C.cyan   },
      { label: 'Zones équipées',  value: String(this.zonesAvecEquipements), rgb: C.green  },
    ];
    const gap = 3, nCols = 4, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    kpis.forEach((kpi, i) => { this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb); });
    y += cardH + gap + 8;

    y = this.pdfSection(doc, 'SITES INDUSTRIELS', `${this.totalSites} site(s)`, margin, y, usable, C.blue);
    const siteH = [
      { title: 'ID',      w: 14, align: 'center' as const },
      { title: 'NOM',     w: 50 },
      { title: 'ADRESSE', w: 75 },
      { title: 'ZONES',   w: 22, align: 'center' as const },
      { title: 'ÉQUIP.',  w: usable - 161, align: 'center' as const },
    ];
    const siteR = this.sites.map(s => [
      { text: String(s.idSite), align: 'center' as const },
      { text: s.nom, bold: true },
      { text: s.adresse ?? '—' },
      { text: String(this.getSiteZonesCount(s.idSite)), badge: { rgb: C.indigo } },
      { text: String(this.getSiteEquipCount(s.idSite)), badge: { rgb: C.purple } },
    ]);
    y = this.pdfTable(doc, siteH, siteR, margin, y, pageW, pageH, margin, 'Sites', C.blue);
    y += 8;

    y = this.pdfSection(doc, 'ZONES', `${this.zonesCount} zone(s)`, margin, y, usable, C.indigo);
    const zoneH = [
      { title: 'ID',          w: 14, align: 'center' as const },
      { title: 'NOM',         w: 50 },
      { title: 'SITE',        w: 50 },
      { title: 'DESCRIPTION', w: 60 },
      { title: 'ÉQUIP.',      w: usable - 174, align: 'center' as const },
    ];
    const zoneR = this.zones.map(z => [
      { text: String(z.idZone), align: 'center' as const },
      { text: z.nom, bold: true },
      { text: this.getSiteNom(z.siteId) },
      { text: z.description ?? '—' },
      { text: String(this.getZoneEquipCount(z.idZone)), badge: { rgb: C.cyan } },
    ]);
    y = this.pdfTable(doc, zoneH, zoneR, margin, y, pageW, pageH, margin, 'Sites', C.indigo);
    this.pdfFinalize(doc, pageW, pageH, margin, 'sites-zones');
    this.showToast('PDF Sites & Zones téléchargé !', 'success');
  }

  // ── PDF Synthèse ─────────────────────────────────────────────────────────────

  private async exportPdfSynthese(): Promise<void> {
    const jsPDF = await this.loadJsPDF();
    const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14, usable = pageW - margin * 2;
    const C = this.PDF_COLORS;
    let y = 34;
    const newPage = () => { doc.addPage(); this.pdfPageHeader(doc, pageW, pageH, 'Synthèse', margin); y = 34; };
    const checkY  = (needed: number) => { if (y + needed > pageH - 14) newPage(); };

    this.pdfPageHeader(doc, pageW, pageH, 'Synthèse', margin);
    this.pdfTxt(doc, 'Rapport de Synthèse Global', margin, y, C.navy, 16, true); y += 5;
    this.pdfTxt(doc, `${this.platformName}  |  Opérateur : ${this.adminName}`, margin, y, C.textMuted, 7.5); y += 6;
    this.pdfSetFill(doc, C.indigo); doc.rect(margin, y, usable, 1, 'F'); y += 6;

    const kpis = [
      { label: 'Sites',         value: String(this.totalSites),         rgb: C.blue   },
      { label: 'Zones',         value: String(this.zonesCount),         rgb: C.indigo },
      { label: 'Équipements',   value: String(this.totalEquipements),   rgb: C.purple },
      { label: 'Mesures',       value: String(this.totalMesures),       rgb: C.cyan   },
      { label: 'Alertes act.',  value: String(this.alertesActives),     rgb: this.alertesActives > 0 ? C.red : C.green },
      { label: 'Seuils dép.',   value: String(this.seuilsDepasses),     rgb: this.seuilsDepasses > 0 ? C.red : C.green },
      { label: 'Utilisateurs',  value: String(this.totalUtilisateurs),  rgb: C.blue   },
      { label: 'Santé syst.',   value: `${this.santeSysteme}%`,         rgb: this.santeSysteme >= this.objectifSante ? C.green : C.red },
    ];
    const gap = 3, nCols = 4, cardW = (usable - gap * (nCols - 1)) / nCols, cardH = 22;
    [0, 4].forEach(offset => {
      kpis.slice(offset, offset + nCols).forEach((kpi, i) => {
        this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb);
      });
      y += cardH + gap;
    });
    y += 6;

    checkY(80);
    y = this.pdfSection(doc, 'RÉPARTITION ÉNERGÉTIQUE', '', margin, y, usable, C.amber);
    const labelW = 30, barW = usable - labelW - 14;
    this.repartitionEnergies.forEach(rep => {
      const rgb = this.hexToRgb(rep.couleur) ?? C.blue;
      this.pdfTxt(doc, rep.nom, margin, y + 4.5, C.textMain, 8, true);
      this.pdfBar(doc, margin + labelW, y, barW, rep.pct, rgb);
      this.pdfTxt(doc, `${rep.pct}%`, margin + labelW + barW + 3, y + 4.5, rgb, 7.5, true);
      y += 10;
    });
    y += 4; checkY(64);

    y = this.pdfSection(doc, 'ÉTAT DES SEUILS', `${this.seuilsActifs} actif(s), ${this.seuilsDepasses} dépassé(s)`, margin, y, usable, C.red);
    this.seuils.filter(s => s.actif).forEach(s => {
      const pct = this.getSeuilPct(s);
      const colorBar: [number,number,number] = s.depassement ? C.red : pct >= 80 ? C.amber : C.green;
      this.pdfTxt(doc, s.energieNom, margin, y + 4.5, C.textMain, 7.5, true);
      this.pdfTxt(doc, `${s.consommationActuelle ?? 0}/${s.valeurSeuil} ${s.energieUnite} (${pct}%)`, margin + usable, y + 4.5, colorBar, 7, false, 'right');
      y += 6;
      const bW = usable - 10;
      this.pdfRR(doc, margin, y, bW, 6, C.grayBg, 2);
      const filled = Math.min((pct / 100) * bW, bW);
      if (filled > 0) { this.pdfSetFill(doc, colorBar); doc.rect(margin, y, filled, 6, 'F'); }
      y += 10;
    });
    if (!this.seuils.filter(s => s.actif).length) {
      this.pdfTxt(doc, 'Aucun seuil actif configuré', margin, y + 5, C.textMuted, 8);
      y += 12;
    }
    y += 4; checkY(64);

    y = this.pdfSection(doc, 'ÉVOLUTION MENSUELLE', '7 derniers mois', margin, y, usable, C.blue);
    this.pdfBarChart(doc, margin, y + 10, usable, 46); y += 64;

    newPage();
    y = this.pdfSection(doc, 'ALERTES', `${this.alertesActives} active(s)`, margin, y, usable, C.red);
    const alertH = [
      { title: 'TYPE',    w: 28 },
      { title: 'MESSAGE', w: 70 },
      { title: 'STATUT',  w: 22, align: 'center' as const },
      { title: 'ÉNERGIE', w: 26 },
      { title: 'DATE',    w: usable - 146 },
    ];
    const alertR = this.alertes.slice(0, 20).map(a => [
      { text: a.type ?? '—', bold: true },
      { text: a.message ?? '—' },
      { text: isAlerteActive(a.statut) ? 'ACTIVE' : 'RÉSOLUE', badge: { rgb: isAlerteActive(a.statut) ? C.red : C.green } },
      { text: a.energie?.nom ?? '—' },
      { text: this.formatDateShort(a.dateCreation) },
    ]);
    y = this.pdfTable(doc, alertH, alertR, margin, y, pageW, pageH, margin, 'Synthèse', C.red);
    y += 6; checkY(20);

    y = this.pdfSection(doc, 'SITES', `${this.totalSites} site(s)`, margin, y, usable, C.blue);
    const siteH = [
      { title: 'NOM',     w: 55 },
      { title: 'ADRESSE', w: 85 },
      { title: 'ZONES',   w: 22, align: 'center' as const },
      { title: 'ÉQUIP.',  w: usable - 162, align: 'center' as const },
    ];
    const siteR = this.sites.map(s => [
      { text: s.nom, bold: true },
      { text: s.adresse ?? '—' },
      { text: String(this.getSiteZonesCount(s.idSite)), badge: { rgb: C.indigo } },
      { text: String(this.getSiteEquipCount(s.idSite)), badge: { rgb: C.purple } },
    ]);
    y = this.pdfTable(doc, siteH, siteR, margin, y, pageW, pageH, margin, 'Synthèse', C.blue);
    this.pdfFinalize(doc, pageW, pageH, margin, 'synthese');
    this.showToast('PDF Synthèse téléchargé !', 'success');
  }

  // ── Finalisation PDF ─────────────────────────────────────────────────────────

  private pdfFinalize(doc: any, pageW: number, pageH: number, margin: number, slug: string): void {
    const totalPages = (doc.internal as any).getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      this.pdfPageFooter(doc, pageW, pageH, margin, p, totalPages);
    }
    const now = new Date();
    const dateFile = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;
    doc.save(`wicmic-${slug}-${dateFile}.pdf`);
  }

  // ── Helpers PDF partagés ──────────────────────────────────────────────────────

  private async loadJsPDF(): Promise<any> {
    if (typeof (window as any).jspdf !== 'undefined') return (window as any).jspdf.jsPDF;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload  = () => (window as any).jspdf?.jsPDF ? resolve((window as any).jspdf.jsPDF) : reject(new Error('jsPDF introuvable'));
      script.onerror = () => reject(new Error('Impossible de charger jsPDF'));
      document.head.appendChild(script);
    });
  }

  private hexToRgb(hex: string): [number, number, number] | null {
    const clean = (hex ?? '').replace('#', '');
    if (clean.length !== 6) return null;
    return [parseInt(clean.substring(0,2),16), parseInt(clean.substring(2,4),16), parseInt(clean.substring(4,6),16)];
  }

  private pdfPageHeader(doc: any, pageW: number, _pageH: number, type: string, margin: number): void {
    const C = this.PDF_COLORS;
    this.pdfSetFill(doc, C.navy); doc.rect(0, 0, pageW, 14, 'F');
    this.pdfSetFill(doc, C.indigo); doc.rect(0, 14, pageW, 2, 'F');
    this.pdfTxt(doc, 'WICMIC TriPower', margin, 9.5, C.white, 9, true);
    this.pdfTxt(doc, `Rapport : ${type}`, pageW / 2, 9.5, C.cyan, 8, false, 'center');
    this.pdfTxt(doc, new Date().toLocaleDateString('fr-FR'), pageW - margin, 9.5, C.white, 8, false, 'right');
  }

  private pdfPageFooter(doc: any, pageW: number, pageH: number, margin: number, page: number, total: number): void {
    const C = this.PDF_COLORS;
    this.pdfSetFill(doc, C.grayLine); doc.rect(margin, pageH - 10, pageW - margin * 2, 0.3, 'F');
    this.pdfTxt(doc, `${this.platformName}  —  Confidentiel`, margin, pageH - 5, C.textMuted, 6.5);
    this.pdfTxt(doc, `Page ${page} / ${total}`, pageW - margin, pageH - 5, C.textMuted, 6.5, false, 'right');
  }

  private pdfTxt(doc: any, text: string, x: number, y: number, rgb: [number,number,number], size: number, bold = false, align: 'left'|'center'|'right' = 'left'): void {
    doc.setTextColor(rgb[0], rgb[1], rgb[2]); doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(text ?? '', x, y, { align });
  }

  private pdfSetFill(doc: any, rgb: [number,number,number]): void { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
  private pdfRR(doc: any, x: number, y: number, w: number, h: number, rgb: [number,number,number], _r = 2): void { this.pdfSetFill(doc, rgb); doc.rect(x, y, w, h, 'F'); }

  private pdfKpiCard(doc: any, x: number, y: number, w: number, h: number, value: string, label: string, rgb: [number,number,number]): void {
    const C = this.PDF_COLORS;
    this.pdfRR(doc, x, y, w, h, C.grayBg, 3); this.pdfSetFill(doc, rgb); doc.rect(x, y, w, 2.5, 'F');
    this.pdfTxt(doc, value, x + w / 2, y + 11, rgb, 14, true, 'center');
    this.pdfTxt(doc, label, x + w / 2, y + 18, C.textMuted, 6.5, false, 'center');
  }

  private pdfSection(doc: any, title: string, subtitle: string, x: number, y: number, w: number, rgb: [number,number,number] = this.PDF_COLORS.indigo): number {
    const C = this.PDF_COLORS;
    this.pdfRR(doc, x, y, w, 8, C.grayBg, 2); this.pdfSetFill(doc, rgb); doc.rect(x, y, 3, 8, 'F');
    this.pdfTxt(doc, title, x + 6, y + 5.5, rgb, 8, true);
    if (subtitle) this.pdfTxt(doc, subtitle, x + w, y + 5.5, C.textMuted, 7, false, 'right');
    return y + 12;
  }

  private pdfBar(doc: any, x: number, y: number, maxW: number, pct: number, rgb: [number,number,number]): void {
    const C = this.PDF_COLORS, h = 8, barW = Math.max(0, Math.min((pct / 100) * maxW, maxW));
    this.pdfRR(doc, x, y, maxW, h, C.grayBg, 2);
    if (barW > 0) { this.pdfSetFill(doc, rgb); doc.rect(x, y, barW, h, 'F'); }
  }

  private pdfBarChart(doc: any, x: number, y: number, w: number, h: number): void {
    const C = this.PDF_COLORS, labels = this.chartData.labels;
    if (!labels.length) return;
    const maxVal = Math.max(...this.chartData.electricite, ...this.chartData.eau, ...this.chartData.gasoil, 1);
    const colW = w / labels.length, barW = (colW - 4) / 3, spacing = 1;
    const elecNom = this.energies.find(e => this.isElec(e.nom))?.nom ?? 'Électricité';
    const eauNom  = this.energies.find(e => this.isEau(e.nom))?.nom  ?? 'Eau';
    const gasNom  = this.energies.find(e => this.isGasoil(e.nom))?.nom ?? 'Gasoil';
    labels.forEach((label, i) => {
      const cx = x + i * colW;
      [{ values: this.chartData.electricite, rgb: C.blue }, { values: this.chartData.eau, rgb: C.cyan }, { values: this.chartData.gasoil, rgb: C.amber }].forEach((s, si) => {
        const val = s.values[i] ?? 0, bh = Math.max(1, (val / maxVal) * h), bx = cx + si * (barW + spacing) + 1, by = y + h - bh;
        this.pdfSetFill(doc, s.rgb); doc.rect(bx, by, barW, bh, 'F');
      });
      this.pdfTxt(doc, label, cx + colW / 2, y + h + 5, C.textMuted, 6, false, 'center');
    });
    const legendY = y + h + 10;
    [{ label: elecNom, rgb: C.blue }, { label: eauNom, rgb: C.cyan }, { label: gasNom, rgb: C.amber }].forEach((item, i) => {
      const lx = x + i * 50;
      this.pdfSetFill(doc, item.rgb); doc.rect(lx, legendY - 3, 6, 3, 'F');
      this.pdfTxt(doc, item.label, lx + 8, legendY, C.textMuted, 6.5);
    });
  }

  private pdfTable(doc: any, headers: { title: string; w: number; align?: string }[], rows: { text: string; bold?: boolean; align?: string; badge?: { rgb: [number,number,number] } }[][], x: number, y: number, pageW: number, pageH: number, margin: number, type: string, _accent: [number,number,number]): number {
    const C = this.PDF_COLORS, rowH = 7.5, headH = 8, totalW = headers.reduce((s, h) => s + h.w, 0);
    const drawHeader = (yy: number) => {
      this.pdfSetFill(doc, C.navy); doc.rect(x, yy, totalW, headH, 'F');
      let cx = x;
      headers.forEach(h => { this.pdfTxt(doc, h.title, cx + (h.align === 'center' ? h.w / 2 : 3), yy + 5.5, C.white, 6.5, true, (h.align as any) ?? 'left'); cx += h.w; });
      return yy + headH;
    };
    y = drawHeader(y);
    rows.forEach((row, ri) => {
      if (y + rowH > pageH - 14) { doc.addPage(); this.pdfPageHeader(doc, pageW, pageH, type, margin); y = 34; y = drawHeader(y); }
      if (ri % 2 === 0) { this.pdfSetFill(doc, C.grayBg); doc.rect(x, y, totalW, rowH, 'F'); }
      let cx = x;
      row.forEach((cell, ci) => {
        const col = headers[ci], text = String(cell.text ?? '');
        if (cell.badge) {
          const bw = Math.min(col.w - 4, 18), bx = cx + (col.w - bw) / 2;
          this.pdfRR(doc, bx, y + 1.5, bw, rowH - 3, cell.badge.rgb, 2);
          this.pdfTxt(doc, text, bx + bw / 2, y + 5, C.white, 5.5, true, 'center');
        } else {
          const align = (cell.align ?? col.align ?? 'left') as 'left'|'center'|'right';
          const tx = align === 'center' ? cx + col.w / 2 : align === 'right' ? cx + col.w - 2 : cx + 2;
          const maxChars = Math.floor(col.w / 1.8);
          this.pdfTxt(doc, text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text, tx, y + 5, C.textMain, 6.5, cell.bold ?? false, align);
        }
        cx += col.w;
      });
      this.pdfSetFill(doc, C.grayLine); doc.rect(x, y + rowH - 0.2, totalW, 0.2, 'F'); y += rowH;
    });
    return y;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // LEGACY CSV
  // ══════════════════════════════════════════════════════════════════════════════

  exportCSV():         void { this.exportEquipementsExcel(); }
  exportEnergiesCSV(): void { this.exportEnergiesExcel(); }
  exportMesuresCSV():  void { this.exportMesuresExcel(); }
  exportRapportCSV(type: string): void {
    if (type === 'mesures')  { this.exportMesuresExcel();  return; }
    if (type === 'energies') { this.exportEnergiesExcel(); return; }
    if (type === 'seuils')   { this.exportSeuilsExcel();   return; }
    this.exportSyntheseExcel();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // HORLOGE
  // ══════════════════════════════════════════════════════════════════════════════

  updateClock(): void {
    const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
    this.currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const days   = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    const months = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    this.currentDate = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ══════════════════════════════════════════════════════════════════════════════

  downloadFile(content: string, filename: string, mime: string): void {
    const blob = new Blob(['\uFEFF' + content], { type: mime + ';charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch { return '—'; }
  }

  formatDateShort(dateStr: string): string {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    } catch { return '—'; }
  }

  getEquipTypeIcon(type: string): string {
    if (!type) return '⚙️'; const t = type.toLowerCase();
    if (t.includes('textile') || t.includes('machine'))    return '🏭';
    if (t.includes('moteur')  || t.includes('électrique')) return '⚡';
    if (t.includes('pompe'))                               return '🔧';
    return '⚙️';
  }

  getEnergyIcon(energieNom: string): string { return this.getEnergieIcon(energieNom); }

  getAdminInitial(): string { return this.adminName?.length > 0 ? this.adminName[0].toUpperCase() : '?'; }

  getRoleLabel(role: string): string {
    if (!role) return '—'; const r = role.toLowerCase();
    if (r.includes('admin'))                                     return 'Administrateur';
    if (r.includes('responsable') && !r.includes('_'))          return 'Responsable';
    if (r.includes('employ'))                                    return 'Employé';
    if (r.includes('electricite') || r.includes('électricité')) return 'Resp. Électricité';
    if (r.includes('eau'))                                       return 'Resp. Eau';
    if (r.includes('gaz') || r.includes('gasoil'))               return 'Resp. Gasoil';
    if (r.includes('energie') || r.includes('énergie'))          return 'Resp. Énergie';
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  getRoleClass(role: string): string {
    if (!role) return 'role-badge role-badge--default'; const r = role.toLowerCase();
    if (r.includes('admin'))                                                      return 'role-badge role-badge--admin';
    if (r.includes('responsable') || r.includes('energie') || r.includes('énergie')) return 'role-badge role-badge--responsable';
    if (r.includes('employ'))                                                     return 'role-badge role-badge--employe';
    return 'role-badge role-badge--default';
  }

  trackById(_index: number, item: any): any {
    return item?.id ?? item?.idSite ?? item?.idZone ?? item?.idEquipement ?? item?.idMesure ?? item?.idAlerte ?? item?.idEnergie ?? item?.idUtilisateur ?? item?.energieId ?? _index;
  }

  getTypeChipClass(type: string): string {
    if (!type) return 'chip chip--gray'; const t = type.toLowerCase();
    if (t.includes('moteur') || t.includes('électrique')) return 'chip chip--blue';
    if (t.includes('pompe'))                              return 'chip chip--cyan';
    if (t.includes('textile') || t.includes('machine'))  return 'chip chip--purple';
    if (t.includes('compresseur'))                        return 'chip chip--amber';
    return 'chip chip--indigo';
  }

  getStatutChipClass(statut: string): string {
    if (!statut) return 'chip chip--gray'; const s = statut.toLowerCase();
    if (s.includes('actif') || s === 'active' || s === 'on') return 'chip chip--green';
    if (s.includes('inactif') || s === 'off')                return 'chip chip--red';
    if (s.includes('maintenance') || s.includes('révision')) return 'chip chip--amber';
    return 'chip chip--gray';
  }

  getEnergyIconFromObj(energie: { nom: string } | null | undefined): string { return energie?.nom ? this.getEnergieIcon(energie.nom) : '⚡'; }

  getEnergyClassFromObj(energie: { nom: string } | null | undefined): string {
    if (!energie?.nom) return 'energy-text--default'; const n = normalizeStr(energie.nom);
    if (n.includes('eau') || n.includes('water'))     return 'energy-text--eau';
    if (n.includes('elec'))                           return 'energy-text--elec';
    if (n.includes('gasoil') || n.includes('diesel')) return 'energy-text--gasoil';
    if (n.includes('solaire'))                        return 'energy-text--solaire';
    return 'energy-text--default';
  }

  getEnergyChipClass(energie: { nom: string } | null | undefined): string {
    if (!energie?.nom) return 'chip chip--gray'; const n = normalizeStr(energie.nom);
    if (n.includes('eau') || n.includes('water'))     return 'chip chip--cyan';
    if (n.includes('elec'))                           return 'chip chip--indigo';
    if (n.includes('gasoil') || n.includes('diesel')) return 'chip chip--amber';
    if (n.includes('solaire'))                        return 'chip chip--yellow';
    return 'chip chip--purple';
  }
}