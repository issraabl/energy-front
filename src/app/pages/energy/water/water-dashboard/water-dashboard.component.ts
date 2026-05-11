import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule }                  from '@angular/common';
import { RouterModule }                  from '@angular/router';
import {
  ReactiveFormsModule,
  FormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Subject }        from 'rxjs';
import { takeUntil }      from 'rxjs/operators';

import { ApiService }        from 'src/app/core/api/api.service';
import { AuthService }       from 'src/app/core/auth/auth.service';
import { PermissionService } from 'src/app/core/auth/permission.service';
import { Mesure, Equipement, Energie } from 'src/app/core/api/api.models';

// ── Types locaux ───────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warn';

export interface ToastMsg {
  id:   number;
  msg:  string;
  type: ToastType;
}

export interface Seuil {
  idSeuil:   number;
  energieId: number;
  valeur:    number;
  periode:   string;
}

export interface AnomalieLocale {
  description: string;
  valeur:      number;
  date:        string;
  resolu:      boolean;
}

export interface AnomalieApi {
  idAnomalie:    number;
  description:   string;
  valeur:        number;
  dateDetection: string;
  severite:      string;
  resolu:        boolean;
}

export interface Alerte {
  idAlerte:     number;
  type:         string;
  seuil:        number;
  severite:     string;
  message:      string;
  equipementId: number | null;
  dateCreation: string;
  traite:       boolean;
}

export interface Recommandation {
  idReco?:         number;
  texte:           string;
  priorite:        string;
  economieEstimee: number | null;
  applique:        boolean;
}

export interface ChartPoint {
  x:       number;
  y:       number;
  label:   string;
  value:   number;
  width?:  number;
  height?: number;
}

export interface YAxisLabel { y: number; label: string; }
export interface XAxisLabel { x: number; label: string; }

export interface StatPeriode {
  label:     string;
  total:     number;
  nbMesures: number;
  cout:      number;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const ENERGIE_EAU_ID    = 3;
const TOAST_DURATION_MS = 4_000;
const PAGE_SIZE         = 10;
const TARIF_DT_PAR_M3   = 0.85;

const CHART_W     = 800;
const CHART_H     = 220;
const CHART_PAD_X = 48;
const CHART_PAD_Y = 16;

// ── Composant ──────────────────────────────────────────────────────────────────

@Component({
  selector:    'wic-water-dashboard',
  standalone:  true,
  imports:     [CommonModule, RouterModule, ReactiveFormsModule, FormsModule],
  templateUrl: './water-dashboard.component.html',
  styleUrls:   ['./water-dashboard.component.css'],
})
export class WaterDashboardComponent implements OnInit, OnDestroy {

  // ── Config énergie ───────────────────────────────
  readonly energieId    = ENERGIE_EAU_ID;
  readonly energieLabel = 'Eau';
  readonly energieIcon  = '💧';
  readonly energieUnite = 'm³';
  readonly tarifUnite   = TARIF_DT_PAR_M3;

  // ── Constantes chart (accessibles dans le template) ──
  readonly CHART_W     = CHART_W;
  readonly CHART_H     = CHART_H;
  readonly CHART_PAD_X = CHART_PAD_X;
  readonly CHART_PAD_Y = CHART_PAD_Y;

  // ── État utilisateur ─────────────────────────────
  currentUser = this.auth.getCurrentUser();
  canWrite    = false;
  canRead     = false;

  // ── Nav ──────────────────────────────────────────
  navCollapsed = false;

  // ── Chargement ───────────────────────────────────
  loading     = true;
  hasApiError = false;

  // ── Horloge ──────────────────────────────────────
  currentTime = new Date();
  private clockInterval: any;

  // ── Données ──────────────────────────────────────
  mesures:          Mesure[]         = [];
  equipements:      Equipement[]     = [];
  energies:         Energie[]        = [];
  seuils:           Seuil[]          = [];
  anomaliesApi:     AnomalieApi[]    = [];
  anomaliesLocales: AnomalieLocale[] = [];
  alertesApi:       Alerte[]         = [];
  recommandations:  Recommandation[] = [];

  // ── Tarif ────────────────────────────────────────
  tarifEau = TARIF_DT_PAR_M3;

  // ── Tabs ─────────────────────────────────────────
  activeTab: 'mesures' | 'seuils' | 'anomalies' | 'alertes' | 'recommandations' | 'analyse' | 'rapports' = 'mesures';

  // ── Chart ────────────────────────────────────────
  chartType:   'ligne' | 'barres'    = 'ligne';
  chartPeriod: '7j' | '30j' | '90j' = '30j';
  hoveredPoint: ChartPoint | null    = null;

  chartPoints:    ChartPoint[]  = [];
  barChartData:   ChartPoint[]  = [];
  yAxisLabels:    YAxisLabel[]  = [];
  visibleXLabels: XAxisLabel[]  = [];
  linePath = '';
  areaPath = '';

  // ── Filtres mesures ──────────────────────────────
  searchMesure  = '';
  filterSource  = '';
  filterEquip   = '';
  sortBy        = 'date_desc';
  mesurePage    = 1;
  mesurePerPage = PAGE_SIZE;

  // ── Filtres alertes ──────────────────────────────
  filterAlerteSeverite = '';
  filterAlerteTraite   = '';

  // ── Modales : mesure ─────────────────────────────
  showMesureModal = false;
  editingMesure:  Mesure | null = null;
  mesureForm!:    FormGroup;
  mesureSaving    = false;
  mesureSaved     = false;

  // ── Modales : seuil ──────────────────────────────
  showSeuilModal = false;
  editingSeuil:  Seuil | null = null;
  seuilForm!:    FormGroup;
  seuilSaving    = false;
  seuilSaved     = false;

  // ── Modales : alerte ─────────────────────────────
  showAlerteModal = false;
  editingAlerte:  Alerte | null = null;
  alerteForm!:    FormGroup;
  alerteSaving    = false;
  alerteSaved     = false;

  // ── Confirm delete ───────────────────────────────
  showDeleteConfirm      = false;
  mesureToDelete:  Mesure | null = null;
  deleteSaving           = false;

  showDeleteSeuilConfirm = false;
  seuilToDelete:  Seuil | null   = null;
  deleteSeuilSaving      = false;

  showDeleteAlerteConfirm = false;
  alerteToDelete: Alerte | null  = null;

  // ── Toasts ───────────────────────────────────────
  toasts: ToastMsg[]   = [];
  private toastCounter = 0;

  // ── Seuil alerte ─────────────────────────────────
  seuilAlerte = 0;

  // ── IA ───────────────────────────────────────────
  iaLoading     = false;
  iaAnalyse     = '';
  showIaChat    = false;
  iaChat        = '';
  iaChatLoading = false;
  iaChatInput   = '';

  // ── Comparaison de périodes ──────────────────────
  comparePeriode:        'mois' | 'trimestre' | 'annee' = 'mois';
  statPeriodeCourante:   StatPeriode | null = null;
  statPeriodePrecedente: StatPeriode | null = null;
  variationConsommation  = 0;

  // ── Lifecycle ────────────────────────────────────
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly api:  ApiService,
    private readonly auth: AuthService,
    private readonly perm: PermissionService,
    private readonly fb:   FormBuilder,
  ) {}

  ngOnInit(): void {
    this.canRead  = this.perm.canRead('eau');
    this.canWrite = this.perm.canWrite('eau');
    this.initForms();
    this.loadData();
    this.startClock();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    clearInterval(this.clockInterval);
  }

  // ══ Horloge ══════════════════════════════════════

  private startClock(): void {
    this.clockInterval = setInterval(() => { this.currentTime = new Date(); }, 1000);
  }

  // ══ Formulaires ══════════════════════════════════

  private initForms(): void {
    this.mesureForm = this.fb.group({
      valeur:       ['', [Validators.required, Validators.min(0)]],
      dateMesure:   [this.nowIso(), Validators.required],
      sourceDonnee: ['Saisie manuelle', Validators.required],
      energieId:    [this.energieId],
      equipementId: [''],
      commentaire:  [''],
    });

    this.seuilForm = this.fb.group({
      periode: ['Mensuel', Validators.required],
      valeur:  ['', [Validators.required, Validators.min(1)]],
    });

    this.alerteForm = this.fb.group({
      type:         ['Consommation élevée', Validators.required],
      severite:     ['Normale', Validators.required],
      seuil:        ['', [Validators.required, Validators.min(0)]],
      message:      ['', Validators.required],
      equipementId: [''],
    });
  }

  private resetMesureForm(): void {
    this.mesureForm.reset({
      valeur: '', dateMesure: this.nowIso(),
      sourceDonnee: 'Saisie manuelle',
      energieId: this.energieId, equipementId: '', commentaire: '',
    });
  }

  // ══ Chargement des données ════════════════════════

  loadData(): void {
    this.loading     = true;
    this.hasApiError = false;
    let pending      = 5;

    const done = () => {
      if (--pending === 0) {
        this.loading = false;
        this.updateSeuilAlerte();
        this.detectAnomaliesLocales();
        this.buildChart();
        this.computeComparaison();
      }
    };

    this.api.getMesuresByEnergie(this.energieId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any[]) => {
          this.mesures = data.map(m => this.normalizeMesure(m));
          done();
        },
        error: () => this.loadMesuresFallback(done),
      });

    this.api.getEquipements()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (data: any) => { this.equipements = data as Equipement[]; done(); },
        error: () => { this.hasApiError = true; done(); },
      });

    this.api.getEnergies()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (data: any) => { this.energies = data as Energie[]; done(); },
        error: () => done(),
      });

    this.api.getSeuilByEnergie(this.energieId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any) => {
          const raw   = Array.isArray(data) ? data : data ? [data] : [];
          this.seuils = raw.map(s => this.normalizeSeuil(s));
          done();
        },
        error: () => {
          this.api.getSeuils()
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (data: any[]) => {
                this.seuils = data
                  .map(s => this.normalizeSeuil(s))
                  .filter(s => s.energieId === this.energieId);
                done();
              },
              error: () => { this.seuils = []; done(); },
            });
        },
      });

    this.api.getAlertes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any[]) => {
          this.alertesApi = (data as Alerte[]).filter(a =>
            (a as any).energieId == null || (a as any).energieId === this.energieId
          );
          done();
        },
        error: () => { this.alertesApi = []; done(); },
      });

    this.api.getAnomalies()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any[]) => {
          this.anomaliesApi = (data as AnomalieApi[]).filter(a =>
            (a as any).energieId == null || (a as any).energieId === this.energieId
          );
        },
        error: () => { this.anomaliesApi = []; },
      });

    this.api.getRecommandations()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any[]) => {
          this.recommandations = (data as Recommandation[]).filter(r =>
            (r as any).energieId == null || (r as any).energieId === this.energieId
          );
        },
        error: () => { this.recommandations = []; },
      });
  }

  private loadMesuresFallback(done: () => void): void {
    this.api.getMesures()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any[]) => {
          this.mesures = data
            .map(m => this.normalizeMesure(m))
            .filter(m => Number(m.energieId) === this.energieId);
          done();
        },
        error: () => {
          this.hasApiError = true;
          this.showToast('Erreur lors du chargement des mesures.', 'error');
          done();
        },
      });
  }

  // ══ KPIs ══════════════════════════════════════════

  get totalConsommation(): number {
    return this.round(this.mesures.reduce((s, m) => s + m.valeur, 0));
  }

  get moyenneMesures(): number {
    return this.mesures.length ? this.round(this.totalConsommation / this.mesures.length) : 0;
  }

  get maxMesure(): number {
    return this.mesures.length ? this.round(Math.max(...this.mesures.map(m => m.valeur))) : 0;
  }

  get minMesure(): number {
    return this.mesures.length ? this.round(Math.min(...this.mesures.map(m => m.valeur))) : 0;
  }

  get totalMesures(): number { return this.mesures.length; }

  get coutTotal(): number {
    return this.round(this.totalConsommation * this.tarifEau, 2);
  }

  get economiePotentielle(): number {
    if (!this.seuilAlerte || this.totalConsommation <= this.seuilAlerte) return 0;
    return this.round((this.totalConsommation - this.seuilAlerte) * this.tarifEau, 2);
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
    return this.round(
      this.mesures
        .filter(m => {
          const d = new Date(m.dateMesure);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((s, m) => s + m.valeur, 0),
    );
  }

  get mesuresAujourd(): number {
    const today = new Date().toDateString();
    return this.mesures.filter(m => new Date(m.dateMesure).toDateString() === today).length;
  }

  get mesuresSemaine(): number {
    const now  = Date.now();
    const week = 7 * 24 * 3600 * 1000;
    return this.mesures.filter(m => now - new Date(m.dateMesure).getTime() <= week).length;
  }

  get tendance(): 'up' | 'down' | 'stable' {
    if (this.mesures.length < 2) return 'stable';
    const sorted = [...this.mesures].sort((a, b) =>
      new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    const mid  = Math.floor(sorted.length / 2);
    const avg  = (arr: Mesure[]) => arr.reduce((s, m) => s + m.valeur, 0) / arr.length;
    const diff = ((avg(sorted.slice(mid)) - avg(sorted.slice(0, mid))) / (avg(sorted.slice(0, mid)) || 1)) * 100;
    return diff > 5 ? 'up' : diff < -5 ? 'down' : 'stable';
  }

  get tendanceLabel(): string {
    return this.tendance === 'up' ? '↑ Hausse' : this.tendance === 'down' ? '↓ Baisse' : '→ Stable';
  }

  get anomaliesCount(): number {
    return this.anomaliesLocales.filter(a => !a.resolu).length
         + this.anomaliesApi.filter(a => !a.resolu).length;
  }

  get alertesActives():    number { return this.alertesApi.filter(a => !a.traite).length; }
  get notifNonLues():      number { return this.anomaliesCount + this.alertesActives; }

  get recommandationsEnCours():   Recommandation[] { return this.recommandations.filter(r => !r.applique); }
  get recommandationsAppliques(): Recommandation[] { return this.recommandations.filter(r => r.applique); }

  private updateSeuilAlerte(): void {
    const mensuel    = this.seuils.find(s => s.periode === 'Mensuel');
    this.seuilAlerte = mensuel?.valeur ?? 0;
  }

  isAboveThreshold(valeur: number): boolean {
    return this.seuilAlerte > 0 && +valeur > this.seuilAlerte;
  }

  private detectAnomaliesLocales(): void {
    if (!this.seuilAlerte) { this.anomaliesLocales = []; return; }
    this.anomaliesLocales = this.mesures
      .filter(m => m.valeur > this.seuilAlerte)
      .map(m => ({
        description: `Consommation de ${m.valeur} m³ dépasse le seuil de ${this.seuilAlerte} m³`,
        valeur:      m.valeur,
        date:        m.dateMesure,
        resolu:      false,
      }));
  }

  resolveAnomalieLocale(a: AnomalieLocale): void {
    a.resolu = true;
    this.showToast('Anomalie marquée comme résolue.', 'success');
  }

  // ══ Filtres & pagination mesures ══════════════════

  onFilterChange(): void { this.mesurePage = 1; }

  get filteredMesures(): Mesure[] {
    let list = [...this.mesures];

    const q = this.searchMesure.trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        m.sourceDonnee.toLowerCase().includes(q) ||
        String(m.valeur).includes(q) ||
        (m.equipement?.nom ?? this.getEquipNom(m.equipementId)).toLowerCase().includes(q) ||
        (m.commentaire ?? '').toLowerCase().includes(q),
      );
    }

    if (this.filterSource) list = list.filter(m => m.sourceDonnee === this.filterSource);
    if (this.filterEquip)  list = list.filter(m => String(m.equipementId) === String(this.filterEquip));

    list.sort((a, b) => {
      switch (this.sortBy) {
        case 'date_asc':  return new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime();
        case 'val_desc':  return b.valeur - a.valeur;
        case 'val_asc':   return a.valeur - b.valeur;
        default:          return new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime();
      }
    });

    return list;
  }

  get pagedMesures(): Mesure[] {
    const start = (this.mesurePage - 1) * this.mesurePerPage;
    return this.filteredMesures.slice(start, start + this.mesurePerPage);
  }

  get mesureTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMesures.length / this.mesurePerPage));
  }

  get mesurePages(): number[] {
    return Array.from({ length: this.mesureTotalPages }, (_, i) => i + 1);
  }

  // ══ Filtres alertes ═══════════════════════════════

  get filteredAlertes(): Alerte[] {
    let list = [...this.alertesApi];
    if (this.filterAlerteSeverite) list = list.filter(a => a.severite === this.filterAlerteSeverite);
    if (this.filterAlerteTraite === 'oui') list = list.filter(a => a.traite);
    if (this.filterAlerteTraite === 'non') list = list.filter(a => !a.traite);
    return list;
  }

  // ══ Chart ══════════════════════════════════════════

  get hasChartData(): boolean { return this.chartPoints.length > 0 || this.barChartData.length > 0; }

  buildChart(): void {
    const now  = Date.now();
    const days = this.chartPeriod === '7j' ? 7 : this.chartPeriod === '30j' ? 30 : 90;
    const ms   = days * 24 * 3600 * 1000;

    const filtered = this.mesures
      .filter(m => now - new Date(m.dateMesure).getTime() <= ms)
      .sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());

    if (!filtered.length) {
      this.chartPoints = []; this.barChartData = [];
      this.yAxisLabels = []; this.visibleXLabels = [];
      this.linePath = ''; this.areaPath = '';
      return;
    }

    const vals    = filtered.map(m => m.valeur);
    const minV    = Math.min(...vals);
    const maxV    = Math.max(...vals);
    const range   = maxV - minV || 1;
    const usableW = CHART_W - 2 * CHART_PAD_X;
    const usableH = CHART_H - 2 * CHART_PAD_Y;

    const toX = (i: number) => CHART_PAD_X + (i / Math.max(filtered.length - 1, 1)) * usableW;
    const toY = (v: number) => CHART_PAD_Y + usableH - ((v - minV) / range) * usableH;

    this.chartPoints = filtered.map((m, i) => ({
      x: toX(i), y: toY(m.valeur),
      label: new Date(m.dateMesure).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      value: m.valeur,
    }));

    if (this.chartPoints.length) {
      const pts    = this.chartPoints;
      const bottom = CHART_PAD_Y + usableH;
      this.linePath = 'M ' + pts.map(p => `${p.x},${p.y}`).join(' L ');
      this.areaPath = `M ${pts[0].x},${bottom} ` +
        pts.map(p => `L ${p.x},${p.y}`).join(' ') +
        ` L ${pts[pts.length - 1].x},${bottom} Z`;
    }

    const barW = Math.max(4, (usableW / filtered.length) - 4);
    this.barChartData = filtered.map((m, i) => {
      const barH = ((m.valeur - minV) / range) * usableH || 4;
      return {
        x: toX(i) - barW / 2, y: CHART_PAD_Y + usableH - barH,
        width: barW, height: barH,
        label: new Date(m.dateMesure).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        value: m.valeur,
      };
    });

    this.yAxisLabels = Array.from({ length: 5 }, (_, i) => {
      const v = minV + (range / 4) * i;
      return { y: toY(v), label: this.round(v).toString() };
    });

    const step = Math.max(1, Math.floor(filtered.length / 8));
    this.visibleXLabels = this.chartPoints
      .filter((_, i) => i % step === 0 || i === filtered.length - 1)
      .map(p => ({ x: p.x, label: p.label }));
  }

  // ══ Seuils ════════════════════════════════════════

  getSeuilPct(s: Seuil): number {
    return s.valeur ? Math.round((this.consommationMoisCourant / s.valeur) * 100) : 0;
  }

  openAddSeuilModal(): void {
    this.editingSeuil = null;
    this.seuilSaved   = false;
    this.seuilForm.reset({ periode: 'Mensuel', valeur: '' });
    this.showSeuilModal = true;
  }

  openEditSeuil(s: Seuil): void {
    this.editingSeuil = s;
    this.seuilSaved   = false;
    this.seuilForm.patchValue({ periode: s.periode, valeur: s.valeur });
    this.showSeuilModal = true;
  }

  /**
   * Enregistrement du seuil.
   *
   * CORRECTION PRINCIPALE :
   *   - En mode édition  → PUT  /seuil/energie/{energieId}   (comportement précédent conservé)
   *   - En mode création → upsertSeuil() qui vérifie d'abord si un seuil existe
   *     déjà côté backend (GET /seuil/energie/{id}) avant de choisir POST ou PUT.
   *     Cela évite le 409 / 500 quand le backend a une contrainte unique sur energieId.
   */
  saveSeuil(): void {
    if (this.seuilForm.invalid) { this.seuilForm.markAllAsTouched(); return; }

    this.seuilSaving = true;

    const formVal = this.seuilForm.value;
    const payload = {
      energieId: this.energieId,
      valeur:    +formVal.valeur,
      periode:   formVal.periode as string,
    };

    // Mode édition : PUT direct sur la ressource existante
    const obs = this.editingSeuil
      ? this.api.updateSeuil(this.editingSeuil.energieId, payload)
      // Mode création : upsert (GET → POST ou PUT selon l'existence)
      : this.api.upsertSeuil(payload);

    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.seuilSaving = false;
        this.seuilSaved  = true;
        this.showToast('Seuil enregistré avec succès !', 'success');
        setTimeout(() => {
          this.showSeuilModal = false;
          this.editingSeuil   = null;
        }, 800);
        this.loadData();
      },
      error: (err: any) => {
        this.seuilSaving = false;
        // Affiche le détail HTTP si disponible pour faciliter le debug
        const detail = err?.error?.message ?? err?.message ?? '';
        const msg    = detail
          ? `Erreur lors de l'enregistrement du seuil : ${detail}`
          : 'Erreur lors de l\'enregistrement du seuil.';
        this.showToast(msg, 'error');
        console.error('[saveSeuil]', err);
      },
    });
  }

  confirmDeleteSeuil(s: Seuil): void {
    this.seuilToDelete          = s;
    this.showDeleteSeuilConfirm = true;
  }

  deleteSeuil(): void {
    if (!this.seuilToDelete) return;
    this.deleteSeuilSaving = true;

    // Suppression côté backend puis mise à jour locale
    this.api.deleteSeuilByEnergie(this.seuilToDelete.energieId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.seuils = this.seuils.filter(s => s.idSeuil !== this.seuilToDelete!.idSeuil);
          this.deleteSeuilSaving      = false;
          this.showDeleteSeuilConfirm = false;
          this.seuilToDelete          = null;
          this.showToast('Seuil supprimé.', 'success');
          this.updateSeuilAlerte();
          this.detectAnomaliesLocales();
        },
        error: () => {
          this.deleteSeuilSaving = false;
          this.showToast('Erreur lors de la suppression du seuil.', 'error');
        },
      });
  }

  // ══ Alertes ════════════════════════════════════════

  openAddAlerte(): void {
    this.editingAlerte = null;
    this.alerteSaved   = false;
    this.alerteForm.reset({
      type: 'Consommation élevée', severite: 'Normale',
      seuil: '', message: '', equipementId: '',
    });
    this.showAlerteModal = true;
  }

  openEditAlerte(a: Alerte): void {
    this.editingAlerte = a;
    this.alerteSaved   = false;
    this.alerteForm.patchValue({
      type: a.type, severite: a.severite,
      seuil: a.seuil, message: a.message,
      equipementId: a.equipementId ?? '',
    });
    this.showAlerteModal = true;
  }

  saveAlerte(): void {
    if (this.alerteForm.invalid) { this.alerteForm.markAllAsTouched(); return; }
    this.alerteSaving = true;
    const payload     = { ...this.alerteForm.value, energieId: this.energieId };
    const obs         = this.editingAlerte
      ? this.api.updateAlerte(this.editingAlerte.idAlerte, payload)
      : this.api.createAlerte(payload);

    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.alerteSaving = false;
        this.alerteSaved  = true;
        this.showToast(this.editingAlerte ? 'Alerte modifiée !' : 'Alerte créée !', 'success');
        setTimeout(() => { this.showAlerteModal = false; this.editingAlerte = null; }, 800);
        this.loadData();
      },
      error: () => {
        this.alerteSaving = false;
        this.showToast('Erreur lors de l\'enregistrement.', 'error');
      },
    });
  }

  traiterAlerte(a: Alerte): void {
    this.api.updateAlerte(a.idAlerte, { ...a, traite: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  () => { a.traite = true; this.showToast('Alerte marquée comme traitée.', 'success'); },
        error: () => { a.traite = true; },
      });
  }

  confirmDeleteAlerte(a: Alerte): void {
    this.alerteToDelete          = a;
    this.showDeleteAlerteConfirm = true;
  }

  deleteAlerte(): void {
    if (!this.alerteToDelete) return;
    this.api.deleteAlerte(this.alerteToDelete.idAlerte)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showDeleteAlerteConfirm = false;
          this.alerteToDelete          = null;
          this.showToast('Alerte supprimée.', 'success');
          this.loadData();
        },
        error: () => this.showToast('Erreur lors de la suppression.', 'error'),
      });
  }

  exportAlertes(): void {
    const header = 'ID,Type,Seuil,Sévérité,Message,Date,Statut\n';
    const rows   = this.alertesApi.map(a =>
      `${a.idAlerte},"${a.type}",${a.seuil},"${a.severite}","${a.message}","${a.dateCreation}","${a.traite ? 'Traité' : 'Actif'}"`
    ).join('\n');
    this.downloadFile(header + rows, 'alertes-eau.csv', 'text/csv');
  }

  // ══ Mesures ════════════════════════════════════════

  openAddMesure(): void {
    this.editingMesure = null;
    this.mesureSaved   = false;
    this.resetMesureForm();
    this.showMesureModal = true;
  }

  openEditMesure(m: Mesure): void {
    this.editingMesure = m;
    this.mesureSaved   = false;
    this.mesureForm.patchValue({
      valeur:       m.valeur,
      dateMesure:   m.dateMesure?.slice(0, 16) ?? this.nowIso(),
      sourceDonnee: m.sourceDonnee,
      energieId:    m.energieId,
      equipementId: m.equipementId ?? '',
      commentaire:  m.commentaire ?? '',
    });
    this.showMesureModal = true;
  }

  closeMesureModal(): void { this.showMesureModal = false; this.editingMesure = null; }

  saveMesure(): void {
    if (!this.canWrite) { this.showToast('Droits insuffisants.', 'error'); return; }
    if (this.mesureForm.invalid) { this.mesureForm.markAllAsTouched(); return; }

    this.mesureSaving = true;
    const payload     = { ...this.mesureForm.value, energieId: this.energieId };
    const obs         = this.editingMesure
      ? this.api.updateMesure(this.editingMesure.idMesure, payload)
      : this.api.createMesure(payload);

    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.mesureSaving = false;
        this.mesureSaved  = true;
        this.showToast(this.editingMesure ? 'Mesure modifiée !' : 'Mesure enregistrée !', 'success');
        setTimeout(() => { this.showMesureModal = false; this.editingMesure = null; }, 900);
        this.loadData();
      },
      error: () => {
        this.mesureSaving = false;
        this.showToast('Erreur lors de l\'enregistrement.', 'error');
      },
    });
  }

  confirmDelete(m: Mesure): void { this.mesureToDelete = m; this.showDeleteConfirm = true; }

  deleteMesure(): void {
    if (!this.mesureToDelete) return;
    this.deleteSaving = true;
    this.api.deleteMesure(this.mesureToDelete.idMesure)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deleteSaving         = false;
          this.showDeleteConfirm    = false;
          this.mesureToDelete       = null;
          this.showToast('Mesure supprimée.', 'success');
          this.loadData();
        },
        error: () => {
          this.deleteSaving = false;
          this.showToast('Erreur lors de la suppression.', 'error');
        },
      });
  }

  exportCSV(): void {
    const header = 'ID,Valeur (m³),Source,Équipement,Commentaire,Date\n';
    const rows   = this.filteredMesures.map(m =>
      `${m.idMesure},${m.valeur},"${m.sourceDonnee}","${m.equipement?.nom ?? this.getEquipNom(m.equipementId)}","${m.commentaire ?? ''}","${m.dateMesure}"`
    ).join('\n');
    this.downloadFile(header + rows, 'mesures-eau.csv', 'text/csv');
  }

  // ══ Recommandations ════════════════════════════════

  appliquerRecommandation(r: Recommandation): void {
    r.applique = true;
    this.showToast('Recommandation marquée comme appliquée.', 'success');
    if (r.idReco != null) {
      this.api.updateRecommandation(r.idReco, { ...r, applique: true })
        .pipe(takeUntil(this.destroy$))
        .subscribe({ error: () => {} });
    }
  }

  // ══ IA ═════════════════════════════════════════════

  toggleIaChat(): void { this.showIaChat = !this.showIaChat; }

  lancerAnalyseIA(): void {
    this.iaLoading = true;
    this.iaAnalyse = '';

    this.api.ollamaAnalyse({
      totalMesures: this.totalMesures,
      moyenne:      this.moyenneMesures,
      max:          this.maxMesure,
      alertes:      this.alertesActives,
      anomalies:    this.anomaliesCount,
      tendance:     this.tendance,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next:  res => { this.iaLoading = false; this.iaAnalyse = res.response; },
      error: () => {
        this.iaLoading = false;
        this.iaAnalyse =
          `Analyse basée sur ${this.totalMesures} mesures.\n` +
          `Consommation totale : ${this.totalConsommation} m³ | Moyenne : ${this.moyenneMesures} m³\n` +
          `Tendance : ${this.tendanceLabel} | Anomalies : ${this.anomaliesCount} | Alertes : ${this.alertesActives}\n\n` +
          (this.anomaliesCount > 0
            ? `⚠️ ${this.anomaliesCount} anomalie(s) détectée(s). Vérifiez les mesures dépassant ${this.seuilAlerte} m³.`
            : `✅ Consommation dans les normes. Continuez à surveiller les tendances.`);
      },
    });
  }

  envoyerIaChat(): void {
    if (!this.iaChatInput.trim() || this.iaChatLoading) return;
    const question     = this.iaChatInput.trim();
    this.iaChatInput   = '';
    this.iaChatLoading = true;
    this.iaChat        = '';

    const prompt =
      `Contexte eau WICMIC — Total : ${this.totalConsommation} m³, ` +
      `Moyenne : ${this.moyenneMesures} m³, Tendance : ${this.tendanceLabel}.\n` +
      `Question : ${question}`;

    this.api.ollamaChat(prompt)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  res => { this.iaChatLoading = false; this.iaChat = res.response; },
        error: () => { this.iaChatLoading = false; this.iaChat = 'Service IA indisponible. Veuillez réessayer.'; },
      });
  }

  // ══ Comparaison de périodes ════════════════════════

  computeComparaison(): void {
    const now = new Date();

    const getRange = (decalage: number): { debut: Date; fin: Date; label: string } => {
      switch (this.comparePeriode) {
        case 'trimestre': {
          const q    = Math.floor(now.getMonth() / 3) - decalage;
          const year = now.getFullYear() + Math.floor(q / 4);
          const qi   = ((q % 4) + 4) % 4;
          return {
            debut:  new Date(year, qi * 3, 1),
            fin:    new Date(year, qi * 3 + 3, 0, 23, 59, 59),
            label: `T${qi + 1} ${year}`,
          };
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
            debut:  new Date(year, m, 1),
            fin:    new Date(year, m + 1, 0, 23, 59, 59),
            label:  new Date(year, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          };
        }
      }
    };

    const stat = (range: { debut: Date; fin: Date; label: string }): StatPeriode => {
      const ms    = this.mesures.filter(m => { const d = new Date(m.dateMesure); return d >= range.debut && d <= range.fin; });
      const total = this.round(ms.reduce((s, m) => s + m.valeur, 0));
      return { label: range.label, total, nbMesures: ms.length, cout: this.round(total * this.tarifEau, 2) };
    };

    this.statPeriodeCourante   = stat(getRange(0));
    this.statPeriodePrecedente = stat(getRange(1));
    this.variationConsommation = this.statPeriodePrecedente.total > 0
      ? Math.round(((this.statPeriodeCourante.total - this.statPeriodePrecedente.total) / this.statPeriodePrecedente.total) * 100)
      : this.statPeriodeCourante.total > 0 ? 100 : 0;
  }

  // ══ Rapports ══════════════════════════════════════

  telechargerRapport(type: string): void {
    const date = new Date().toLocaleDateString('fr-FR');
    switch (type) {
      case 'mensuel': {
        const txt = [
          `RAPPORT MENSUEL EAU — ${date}`, '='.repeat(50),
          `Consommation totale  : ${this.totalConsommation} m³`,
          `Mesures ce mois      : ${this.mesuresMoisCourant}`,
          `Coût estimé          : ${this.coutTotal} DT`,
          `Tendance             : ${this.tendanceLabel}`,
          `Anomalies actives    : ${this.anomaliesCount}`,
        ].join('\n');
        this.downloadFile(txt, 'rapport-mensuel-eau.txt', 'text/plain');
        break;
      }
      case 'csv':     this.exportCSV(); break;
      case 'alertes': this.exportAlertes(); break;
      case 'anomalies': {
        const txt = [
          `RAPPORT ANOMALIES EAU — ${date}`, '='.repeat(50),
          ...this.anomaliesLocales.map(a =>
            `[${a.resolu ? 'RÉSOLU' : 'ACTIF'}] ${a.description} | ${a.valeur} m³`),
        ].join('\n');
        this.downloadFile(txt, 'rapport-anomalies-eau.txt', 'text/plain');
        break;
      }
      case 'recommandations': {
        const txt = [
          `RAPPORT RECOMMANDATIONS EAU — ${date}`, '='.repeat(50),
          ...this.recommandations.map(r =>
            `[${r.applique ? 'APPLIQUÉ' : 'EN ATTENTE'}] (${r.priorite}) ${r.texte} — Économie : ${r.economieEstimee ?? '—'} DT`
          ),
        ].join('\n');
        this.downloadFile(txt, 'rapport-recommandations-eau.txt', 'text/plain');
        break;
      }
      default: {
        const txt = [
          `RAPPORT COMPLET EAU — ${date}`, '='.repeat(50),
          `Total mesures        : ${this.totalMesures}`,
          `Consommation totale  : ${this.totalConsommation} m³`,
          `Moyenne              : ${this.moyenneMesures} m³`,
          `Max                  : ${this.maxMesure} m³`,
          `Coût total estimé    : ${this.coutTotal} DT`,
          `Tendance             : ${this.tendanceLabel}`,
          `Anomalies actives    : ${this.anomaliesCount}`,
          `Alertes actives      : ${this.alertesActives}`,
          `Économie potentielle : ${this.economiePotentielle} DT`,
        ].join('\n');
        this.downloadFile(txt, 'rapport-complet-eau.txt', 'text/plain');
      }
    }
    this.showToast('Rapport téléchargé avec succès.', 'success');
  }

  // ══ CSS helpers ═══════════════════════════════════

  getSeveriteClass(severite: string): Record<string, boolean> {
    return {
      'tag--danger': severite === 'Critique',
      'tag--warn':   severite === 'Haute',
      'tag--ghost':  severite === 'Normale' || !severite,
    };
  }

  getPrioriteClass(priorite: string): Record<string, boolean> {
    return {
      'tag--danger': priorite === 'Haute',
      'tag--warn':   priorite === 'Moyenne',
      'tag--ghost':  priorite === 'Faible' || !priorite,
    };
  }

  recalcCout(): void { /* coutTotal est un getter réactif */ }

  // ══ Utilitaires publics ═══════════════════════════

  getEquipNom(id: number | null | undefined): string {
    if (id == null) return '—';
    return this.equipements.find(e => e.idEquipement === +id)?.nom ?? '—';
  }

  min(a: number, b: number): number { return Math.min(a, b); }

  // ══ Toasts ════════════════════════════════════════

  showToast(msg: string, type: ToastType): void {
    const id = ++this.toastCounter;
    this.toasts.unshift({ id, msg, type });
    setTimeout(() => this.dismissToast(id), TOAST_DURATION_MS);
  }

  dismissToast(id: number): void { this.toasts = this.toasts.filter(t => t.id !== id); }

  // ══ TrackBy ═══════════════════════════════════════

  trackById(_: number, item: Mesure): number          { return item.idMesure; }
  trackByEquipId(_: number, item: Equipement): number { return item.idEquipement; }
  trackByToastId(_: number, item: ToastMsg): number   { return item.id; }

  // ══ Auth ══════════════════════════════════════════

  logout(): void { this.auth.logout(); }

  // ══ Privés ════════════════════════════════════════

  private round(value: number, decimals = 1): number { return +value.toFixed(decimals); }
  private nowIso(): string { return new Date().toISOString().slice(0, 16); }

  private normalizeSeuil(s: any): Seuil {
    return {
      idSeuil:   s.idSeuil   ?? s.IdSeuil   ?? 0,
      energieId: s.energieId ?? s.EnergieId ?? 0,
      valeur:    +(s.valeur  ?? s.Valeur    ?? 0),
      periode:   s.periode   ?? s.Periode   ?? '',
    };
  }

  private normalizeMesure(m: any): Mesure {
    return {
      idMesure:     m.idMesure     ?? m.IdMesure    ?? 0,
      valeur:       +(m.valeur     ?? m.Valeur       ?? 0),
      dateMesure:   m.dateMesure   ?? m.DateMesure   ?? new Date().toISOString(),
      dateCreation: m.dateCreation ?? m.DateCreation ?? new Date().toISOString(),
      sourceDonnee: m.sourceDonnee ?? m.SourceDonnee ?? '',
      energieId:    m.energieId    ?? m.EnergieId    ?? m.energie?.idEnergie ?? 0,
      energie:      m.energie      ?? m.Energie      ?? null,
      equipementId: m.equipementId ?? m.EquipementId ?? null,
      equipement:   m.equipement   ?? m.Equipement   ?? null,
      commentaire:  m.commentaire  ?? m.Commentaire  ?? '',
    } as Mesure;
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}