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

export interface Anomalie {
  idAnomalie: number;
  type: string;
  message: string;
  statut: 'active' | 'traitée';
  dateCreation: string;
}

export interface Energie {
  idEnergie: number;
  nom: string;
  unite: string;
  description?: string;
  facteurConversion?: number;
  couleur?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatut(statut: string): string {
  if (!statut) return '';
  return statut.toString().trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isAlerteActive(statut: string): boolean {
  const s = normalizeStatut(statut);
  return s === 'active' || s === 'actif' || s === 'actives';
}

function isAlerteResolue(statut: string): boolean {
  const s = normalizeStatut(statut);
  return s === 'resolue' || s === 'reolue' || s === 'resolved' || s === 'resolu';
}

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
  Math = Math;
  private readonly API = 'https://localhost:7128/api';

  // ── Navigation ──────────────────────────────────────────────────────────────
  activeSection    = 'accueil';
  sidebarCollapsed = false;
  loading          = false;
  toastMessage     = '';
  toastType: 'success' | 'error' | 'info' = 'success';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldScrollChat = false;

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
  platformName = 'WICMIC EnergyTracker v1';

  // ── KPIs ────────────────────────────────────────────────────────────────────
  totalSites        = 0;
  totalEquipements  = 0;
  totalMesures      = 0;
  totalAlertes      = 0;
  totalUtilisateurs = 0;
  zonesCount        = 0;
  santeSysteme      = 100;
  consommationTotale  = 0;
  consommationMoyenne = 0;
  consommationMax     = 0;
  consommationMin     = 0;

  // ── Données API ─────────────────────────────────────────────────────────────
  utilisateurs: Utilisateur[] = [];
  equipements:  Equipement[]  = [];
  mesures:      Mesure[]      = [];
  alertes:      Alerte[]      = [];
  anomalies:    Anomalie[]    = [];
  sites:        Site[]        = [];
  zones:        Zone[]        = [];
  energies:     Energie[]     = [];

  // ── Répartition ─────────────────────────────────────────────────────────────
  repartitionElec   = 0;
  repartitionEau    = 0;
  repartitionGasoil = 0;

  // ── Chart Data ───────────────────────────────────────────────────────────────
  chartData: { labels: string[]; electricite: number[]; eau: number[]; gasoil: number[] } = {
    labels: [], electricite: [], eau: [], gasoil: []
  };

  // ── Utilisateurs UI ─────────────────────────────────────────────────────────
  searchUser       = '';
  showNewUserModal = false;
  editingUser:     Utilisateur | null = null;
  newUser: Partial<Utilisateur & { password: string }> = { nom: '', email: '', password: '', role: 'employé' };

  // ── Sites UI ────────────────────────────────────────────────────────────────
  searchSite    = '';
  showSiteModal = false;
  editingSite:  Site | null = null;
  // ✅ FIX: initialisation explicite avec des chaînes vides
  newSite: { nom: string; adresse: string; description: string } = { nom: '', adresse: '', description: '' };

  // ── Zones UI ────────────────────────────────────────────────────────────────
  searchZone     = '';
  filtreZoneSite = '';
  showZoneModal  = false;
  editingZone:   Zone | null = null;
  newZone: Partial<Zone> = { nom: '', siteId: undefined, description: '' };

  // ── Équipements UI ──────────────────────────────────────────────────────────
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

  // ── Mesures UI ──────────────────────────────────────────────────────────────
  searchMesure    = '';
  sortMesure      = 'Date — récent';
  mesuresPage     = 1;
  mesuresPerPage  = 20;
  showMesureModal = false;
  editingMesure:  Mesure | null = null;
  newMesure: Partial<Mesure> = {
    valeur:       0,
    dateMesure:   new Date().toISOString().slice(0, 16),
    sourceDonnee: '',
    energieId:    undefined,
    equipementId: undefined
  };

  // ── Alertes UI ──────────────────────────────────────────────────────────────
  searchAlerte    = '';
  filtreAlerte    = 'Toutes';
  showAlerteModal = false;
  editingAlerte:  Alerte | null = null;
  newAlerte: Partial<Alerte> = {
    type: '', message: '', statut: 'active', energieId: undefined, equipementId: undefined
  };

  // ── Anomalies UI ────────────────────────────────────────────────────────────
  searchAnomalie = '';

  // ── Énergies UI ─────────────────────────────────────────────────────────────
  searchEnergie     = '';
  showEnergieModal  = false;
  editingEnergie:   Energie | null = null;
  newEnergie: Partial<Energie> = {
    nom: '', unite: '', description: '', facteurConversion: 1, couleur: '#6366f1'
  };

  // ── Statistiques ────────────────────────────────────────────────────────────
  statsDebut = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
  statsFin   = new Date().toISOString().split('T')[0];

  // ── Profil ──────────────────────────────────────────────────────────────────
  motDePasseActuel    = '';
  nouveauMotDePasse   = '';
  confirmerMotDePasse = '';
  showPassActuel  = false;
  showPassNouveau = false;
  showPassConfirm = false;

  // ── IA ──────────────────────────────────────────────────────────────────────
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

  // ── Export PDF ─────────────────────────────────────────────────────────────
  exportingPDF = false;

  // ── PDF Colors ─────────────────────────────────────────────────────────────
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
    this.updateClock();
    this.clockSub = interval(1000).subscribe(() => this.updateClock());
    this.loadAllData();
  }

  ngOnDestroy(): void {
    this.clockSub?.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollChat && this.iaMessagesContainer) {
      const el = this.iaMessagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollChat = false;
    }
  }

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

        if (this.alertes.length > 0) {
          const statuts = [...new Set(this.alertes.map(a => a.statut))];
          console.log('[DEBUG] Statuts alertes reçus:', statuts);
        }

        this.computeKPIs();
        this.computeRepartition();
        this.computeChartData();
        this.loading = false;
      },
      error: (err) => {
        console.error('Erreur chargement données:', err);
        this.showToast('Erreur lors du chargement des données', 'error');
        this.loading = false;
      }
    });

    this.http.get<Anomalie[]>(`${this.API}/Anomalies`).subscribe({
      next:  (data) => { this.anomalies = data || []; },
      error: ()     => { this.anomalies = []; }
    });
  }

  private refreshAfterChange(): void {
    this.computeKPIs();
    this.computeRepartition();
    this.computeChartData();
  }

  reloadMesures(): void {
    this.http.get<Mesure[]>(`${this.API}/Mesures`).subscribe({
      next:  data => { this.mesures = data || []; this.refreshAfterChange(); },
      error: ()   => this.showToast('Erreur rechargement mesures', 'error')
    });
  }

  reloadAlertes(): void {
    this.http.get<Alerte[]>(`${this.API}/Alertes`).subscribe({
      next: data => {
        this.alertes = data || [];
        console.log('[DEBUG] Alertes rechargées:', this.alertes.length,
          'statuts:', [...new Set(this.alertes.map(a => a.statut))]);
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

  reloadAnomalies(): void {
    this.http.get<Anomalie[]>(`${this.API}/Anomalies`).subscribe({
      next:  d => { this.anomalies = d || []; },
      error: () => {}
    });
  }

  reloadSites(): void {
    this.http.get<Site[]>(`${this.API}/Sites`).subscribe({
      next: data => {
        this.sites      = data || [];
        this.totalSites = this.sites.length;
        this.showToast('Sites rechargés', 'success');
      },
      error: () => this.showToast('Erreur rechargement sites', 'error')
    });
  }

  reloadZones(): void {
    this.http.get<Zone[]>(`${this.API}/Zones`).subscribe({
      next: data => {
        this.zones      = data || [];
        this.zonesCount = this.zones.length;
        this.showToast('Zones rechargées', 'success');
      },
      error: () => this.showToast('Erreur rechargement zones', 'error')
    });
  }

  reloadEnergies(): void {
    this.http.get<Energie[]>(`${this.API}/Energies`).subscribe({
      next:  data => { this.energies = data || []; this.showToast('Énergies rechargées', 'success'); },
      error: ()   => this.showToast('Erreur rechargement énergies', 'error')
    });
  }

  reloadEquipements(): void {
    this.http.get<Equipement[]>(`${this.API}/Equipements`).subscribe({
      next: data => {
        this.equipements      = data || [];
        this.totalEquipements = this.equipements.length;
        this.showToast('Équipements rechargés', 'success');
      },
      error: () => this.showToast('Erreur rechargement équipements', 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // KPIs
  // ══════════════════════════════════════════════════════════════════════════════

  computeKPIs(): void {
    this.totalUtilisateurs = this.utilisateurs.length;
    this.totalEquipements  = this.equipements.length;
    this.totalMesures      = this.mesures.length;
    this.totalSites        = this.sites.length;
    this.zonesCount        = this.zones.length;

    this.totalAlertes = this.alertes.filter(a => isAlerteActive(a.statut)).length;
    console.log(`[DEBUG] computeKPIs: ${this.alertes.length} alertes totales, ${this.totalAlertes} actives`);

    if (this.mesures.length) {
      const vals               = this.mesures.map(m => Number(m.valeur) || 0);
      this.consommationTotale  = Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
      this.consommationMoyenne = Math.round((this.consommationTotale / vals.length) * 100) / 100;
      this.consommationMax     = Math.max(...vals);
      this.consommationMin     = Math.min(...vals);
    } else {
      this.consommationTotale  = 0;
      this.consommationMoyenne = 0;
      this.consommationMax     = 0;
      this.consommationMin     = 0;
    }

    this.santeSysteme = this.totalAlertes === 0
      ? 100
      : Math.max(0, Math.round(100 - (this.totalAlertes / Math.max(this.totalMesures, 1)) * 100));
  }

  computeRepartition(): void {
    const total = this.mesures.reduce((s, m) => s + (Number(m.valeur) || 0), 0);
    if (!total) {
      this.repartitionElec = this.repartitionEau = this.repartitionGasoil = 0;
      return;
    }
    const elec = this.mesures.filter(m => m.energieId === 1).reduce((s, m) => s + (Number(m.valeur) || 0), 0);
    const gas  = this.mesures.filter(m => m.energieId === 2).reduce((s, m) => s + (Number(m.valeur) || 0), 0);
    const eau  = this.mesures.filter(m => m.energieId === 3).reduce((s, m) => s + (Number(m.valeur) || 0), 0);
    this.repartitionElec   = Math.round((elec / total) * 100);
    this.repartitionGasoil = Math.round((gas  / total) * 100);
    this.repartitionEau    = Math.round((eau  / total) * 100);
  }

  computeChartData(): void {
    const moisMap    = new Map<string, { elec: number; eau: number; gasoil: number }>();
    const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

    this.mesures.forEach(m => {
      const d = new Date(m.dateMesure);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!moisMap.has(key)) moisMap.set(key, { elec: 0, eau: 0, gasoil: 0 });
      const entry = moisMap.get(key)!;
      if (m.energieId === 1) entry.elec   += Number(m.valeur) || 0;
      if (m.energieId === 2) entry.gasoil += Number(m.valeur) || 0;
      if (m.energieId === 3) entry.eau    += Number(m.valeur) || 0;
    });

    const sorted = Array.from(moisMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7);

    this.chartData = {
      labels:      sorted.map(([k]) => moisLabels[parseInt(k.split('-')[1]) - 1]),
      electricite: sorted.map(([, v]) => Math.round(v.elec   / 100)),
      eau:         sorted.map(([, v]) => Math.round(v.eau    / 100)),
      gasoil:      sorted.map(([, v]) => Math.round(v.gasoil / 100))
    };
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
    if (section === 'anomalies')                                      this.reloadAnomalies();
    if (section === 'sites')                                          this.reloadSites();
    if (section === 'zones')                                          this.reloadZones();
    if (section === 'energies')                                       this.reloadEnergies();
    if (section === 'equipements')                                    this.reloadEquipements();
    if (section === 'accueil')                                        this.reloadAlertes();
  }

  toggleSidebar(): void { this.sidebarCollapsed = !this.sidebarCollapsed; }

  logout(): void { this.auth.logout(); }

  // ══════════════════════════════════════════════════════════════════════════════
  // UTILISATEURS — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredUsers(): Utilisateur[] {
    if (!this.searchUser) return this.utilisateurs;
    const q = this.searchUser.toLowerCase();
    return this.utilisateurs.filter(u =>
      u.nom.toLowerCase().includes(q)   ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  }

  get adminCount(): number { return this.utilisateurs.filter(u => u.role.toLowerCase().includes('admin')).length; }
  get respCount():  number { return this.utilisateurs.filter(u => u.role.toLowerCase().includes('responsable')).length; }
  get empCount():   number { return this.utilisateurs.filter(u => u.role.toLowerCase().includes('employ')).length; }

  get donutCircumference(): number { return 2 * Math.PI * 54; }
  get donutAdminPct():  number { return this.utilisateurs.length ? (this.adminCount / this.utilisateurs.length) * 100 : 0; }
  get donutRespPct():   number { return this.utilisateurs.length ? (this.respCount  / this.utilisateurs.length) * 100 : 0; }
  get donutEmpPct():    number { return this.utilisateurs.length ? (this.empCount   / this.utilisateurs.length) * 100 : 0; }
  donutOffset(pct: number): number { return (pct / 100) * this.donutCircumference; }
  donutDash(pct: number):   number { return (pct / 100) * this.donutCircumference; }

  openNewUser(): void {
    this.newUser     = { nom: '', email: '', password: '', role: 'employé' };
    this.editingUser = null;
    this.showNewUserModal = true;
  }

  editUser(user: Utilisateur): void {
    this.editingUser = { ...user };
    this.newUser     = { nom: user.nom, email: user.email, role: user.role };
    this.showNewUserModal = true;
  }

  saveUser(): void {
    if (!this.newUser.nom?.trim() || !this.newUser.email?.trim()) {
      this.showToast('Nom et email requis', 'error'); return;
    }
    if (!this.editingUser && !this.newUser.password?.trim()) {
      this.showToast('Mot de passe requis', 'error'); return;
    }

    if (this.editingUser) {
      const payload = { ...this.editingUser, nom: this.newUser.nom, email: this.newUser.email, role: this.newUser.role };
      this.http.put(`${this.API}/Utilisateurs/${this.editingUser.idUtilisateur}`, payload).subscribe({
        next: () => {
          this.showNewUserModal = false;
          this.editingUser = null;
          this.reloadUtilisateurs();
          this.showToast('Utilisateur modifié avec succès', 'success');
        },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Utilisateur>(`${this.API}/Utilisateurs`, this.newUser).subscribe({
        next: () => {
          this.showNewUserModal = false;
          this.reloadUtilisateurs();
          this.showToast('Utilisateur créé avec succès', 'success');
        },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteUser(id: number): void {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    this.http.delete(`${this.API}/Utilisateurs/${id}`).subscribe({
      next: () => {
        this.utilisateurs = this.utilisateurs.filter(u => u.idUtilisateur !== id);
        this.computeKPIs();
        this.showToast('Utilisateur supprimé', 'success');
      },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  getUserAvatar(nom: string): string {
    return nom?.length > 0 ? nom[0].toUpperCase() : '?';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SITES — CRUD  ✅ CORRIGÉ
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredSites(): Site[] {
    if (!this.searchSite) return this.sites;
    const q = this.searchSite.toLowerCase();
    return this.sites.filter(s =>
      (s.nom         ?? '').toLowerCase().includes(q) ||
      (s.adresse     ?? '').toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    );
  }

  getSiteZonesCount(siteId: number): number {
    return this.zones.filter(z => Number(z.siteId) === Number(siteId)).length;
  }

  getSiteEquipCount(siteId: number): number {
    const zoneIds = this.zones
      .filter(z => Number(z.siteId) === Number(siteId))
      .map(z => z.idZone);
    return this.equipements.filter(e => e.zoneId !== undefined && zoneIds.includes(Number(e.zoneId))).length;
  }

  // ✅ FIX: réinitialisation avec type fort, pas Partial
  openNewSite(): void {
    this.newSite     = { nom: '', adresse: '', description: '' };
    this.editingSite = null;
    this.showSiteModal = true;
  }

  editSite(site: Site): void {
    this.editingSite = { ...site };
    this.newSite = {
      nom:         site.nom         ?? '',
      adresse:     site.adresse     ?? '',
      description: site.description ?? ''
    };
    this.showSiteModal = true;
  }

  // ✅ FIX PRINCIPAL: saveSite entièrement reécrit
  saveSite(): void {
    // 1. Validation
    const nomTrimmed = (this.newSite.nom ?? '').trim();
    if (!nomTrimmed) {
      this.showToast('Le nom du site est requis', 'error');
      return;
    }

    // 2. Payload propre
    const payload = {
      nom:         nomTrimmed,
      adresse:     (this.newSite.adresse     ?? '').trim() || null,
      description: (this.newSite.description ?? '').trim() || null,
    };

    if (this.editingSite) {
      // ── MODIFICATION ──
      const fullPayload = {
        idSite:      this.editingSite.idSite,
        nom:         payload.nom,
        adresse:     payload.adresse,
        description: payload.description,
      };

      this.http.put(`${this.API}/Sites/${this.editingSite.idSite}`, fullPayload).subscribe({
        next: () => {
          this.showSiteModal = false;
          this.editingSite   = null;
          this.newSite       = { nom: '', adresse: '', description: '' };
          this.showToast('Site modifié avec succès', 'success');
          // Rechargement depuis serveur
          this.http.get<Site[]>(`${this.API}/Sites`).subscribe({
            next: data => {
              this.sites      = data || [];
              this.totalSites = this.sites.length;
            }
          });
        },
        error: (e: any) => {
          const msg = e.error?.message || e.error?.title || e.statusText || 'Erreur inconnue';
          this.showToast('Erreur modification site : ' + msg, 'error');
          console.error('[saveSite PUT]', e);
        }
      });

    } else {
      // ── CRÉATION ──
      this.http.post<Site>(`${this.API}/Sites`, payload).subscribe({
        next: (created) => {
          this.showSiteModal = false;
          this.editingSite   = null;
          this.showToast('Site créé avec succès', 'success');

          // ✅ FIX: On recharge TOUJOURS depuis le serveur après création
          // pour avoir le vrai objet avec idSite et nom corrects
          this.http.get<Site[]>(`${this.API}/Sites`).subscribe({
            next: data => {
              this.sites      = data || [];
              this.totalSites = this.sites.length;
              // Reset APRÈS rechargement pour éviter que le binding réinitialise avant
              this.newSite = { nom: '', adresse: '', description: '' };
            },
            error: () => {
              // Fallback: si rechargement échoue, on ajoute manuellement
              // avec les données qu'on connaît
              if (created && created.idSite) {
                // Le serveur a renvoyé l'objet complet
                this.sites = [...this.sites, created];
              } else {
                // Dernier recours: construire l'objet depuis le payload
                const fallbackSite: Site = {
                  idSite:      created?.idSite ?? Date.now(),
                  nom:         payload.nom,
                  adresse:     payload.adresse ?? undefined,
                  description: payload.description ?? undefined,
                };
                this.sites = [...this.sites, fallbackSite];
              }
              this.totalSites = this.sites.length;
              this.newSite    = { nom: '', adresse: '', description: '' };
            }
          });
        },
        error: (e) => {
          const msg = e.error?.message || e.error?.title || e.statusText || 'Erreur inconnue';
          this.showToast('Erreur création site : ' + msg, 'error');
          console.error('[saveSite POST]', e);
        }
      });
    }
  }

  deleteSite(id: number): void {
    if (!confirm('Supprimer ce site ? Toutes les zones associées seront affectées.')) return;
    this.http.delete(`${this.API}/Sites/${id}`).subscribe({
      next: () => {
        this.sites      = this.sites.filter(s => s.idSite !== id);
        this.totalSites = this.sites.length;
        this.showToast('Site supprimé', 'success');
      },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ZONES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredZones(): Zone[] {
    return this.zones.filter(z => {
      const matchSearch = !this.searchZone ||
        z.nom.toLowerCase().includes(this.searchZone.toLowerCase()) ||
        (z.description ?? '').toLowerCase().includes(this.searchZone.toLowerCase());
      const matchSite = !this.filtreZoneSite || String(z.siteId) === String(this.filtreZoneSite);
      return matchSearch && matchSite;
    });
  }

  getSiteNom(siteId: number): string {
    return this.sites.find(s => Number(s.idSite) === Number(siteId))?.nom ?? '—';
  }

  getZoneEquipCount(zoneId: number): number {
    return this.equipements.filter(e => Number(e.zoneId) === Number(zoneId)).length;
  }

  openNewZone(): void {
    this.newZone     = { nom: '', siteId: undefined, description: '' };
    this.editingZone = null;
    this.showZoneModal = true;
  }

  editZone(zone: Zone): void {
    this.editingZone = { ...zone };
    this.newZone     = { nom: zone.nom, siteId: zone.siteId, description: zone.description ?? '' };
    this.showZoneModal = true;
  }

  saveZone(): void {
    if (!this.newZone.nom?.trim())  { this.showToast('Le nom de la zone est requis', 'error'); return; }
    if (!this.newZone.siteId)       { this.showToast('Veuillez sélectionner un site', 'error'); return; }

    const payload = { ...this.newZone, siteId: Number(this.newZone.siteId) };

    const refreshZones = () => {
      this.http.get<Zone[]>(`${this.API}/Zones`).subscribe({
        next: data => { this.zones = data || []; this.zonesCount = this.zones.length; }
      });
    };

    if (this.editingZone) {
      const fullPayload = { ...this.editingZone, ...payload };
      this.http.put(`${this.API}/Zones/${this.editingZone.idZone}`, fullPayload).subscribe({
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

  deleteZone(id: number): void {
    if (!confirm('Supprimer cette zone ?')) return;
    this.http.delete(`${this.API}/Zones/${id}`).subscribe({
      next: () => {
        this.zones      = this.zones.filter(z => z.idZone !== id);
        this.zonesCount = this.zones.length;
        this.showToast('Zone supprimée', 'success');
      },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ÉQUIPEMENTS — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredEquipements(): Equipement[] {
    return this.equipements.filter(e => {
      const zone = e.zone?.nom ?? '';
      const type = e.typeEquipement ?? '';
      const matchZone   = this.filtreZone === 'Toutes les zones' || zone === this.filtreZone;
      const matchType   = this.filtreType === 'Tous les types'   || type === this.filtreType;
      const matchSearch = !this.searchEquipement ||
        e.nom.toLowerCase().includes(this.searchEquipement.toLowerCase()) ||
        type.toLowerCase().includes(this.searchEquipement.toLowerCase());
      return matchZone && matchType && matchSearch;
    });
  }

  get uniqueZones(): string[] {
    return ['Toutes les zones', ...new Set(this.equipements.map(e => e.zone?.nom ?? 'Sans zone'))];
  }
  get uniqueTypes(): string[] {
    return ['Tous les types', ...new Set(this.equipements.map(e => e.typeEquipement))];
  }
  get totalTypes(): number { return new Set(this.equipements.map(e => e.typeEquipement)).size; }

  getSiteFromZone(zoneId: number | undefined): string {
    if (!zoneId) return '—';
    const zone = this.zones.find(z => Number(z.idZone) === Number(zoneId));
    if (!zone) return '—';
    return this.getSiteNom(zone.siteId);
  }

  openNewEquipement(): void {
    this.newEquipement = {
      nom: '', typeEquipement: '', statut: 'actif', puissance: undefined,
      energieId: this.energies.length > 0 ? this.energies[0].idEnergie : undefined,
      zoneId: undefined, description: ''
    };
    this.editingEquipement = null;
    this.showEquipementModal = true;
  }

  editEquipement(eq: Equipement): void {
    this.editingEquipement = { ...eq };
    this.newEquipement = {
      nom: eq.nom, typeEquipement: eq.typeEquipement, statut: eq.statut,
      puissance: eq.puissance, energieId: eq.energieId, zoneId: eq.zoneId, description: eq.description
    };
    this.showEquipementModal = true;
  }

  saveEquipement(): void {
    if (!this.newEquipement.nom?.trim())            { this.showToast("Le nom de l'équipement est requis", 'error'); return; }
    if (!this.newEquipement.typeEquipement?.trim()) { this.showToast('Le type est requis', 'error'); return; }
    if (!this.newEquipement.energieId)              { this.showToast("Veuillez sélectionner un type d'énergie", 'error'); return; }

    const payload = {
      ...this.newEquipement,
      energieId: Number(this.newEquipement.energieId),
      zoneId:    this.newEquipement.zoneId    ? Number(this.newEquipement.zoneId)    : null,
      puissance: this.newEquipement.puissance ? Number(this.newEquipement.puissance) : null
    };

    if (this.editingEquipement) {
      const fullPayload = { ...this.editingEquipement, ...payload };
      this.http.put(`${this.API}/Equipements/${this.editingEquipement.idEquipement}`, fullPayload).subscribe({
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

  deleteEquipement(id: number): void {
    if (!confirm('Supprimer cet équipement ?')) return;
    this.http.delete(`${this.API}/Equipements/${id}`).subscribe({
      next: () => {
        this.equipements      = this.equipements.filter(e => e.idEquipement !== id);
        this.totalEquipements = this.equipements.length;
        this.showToast('Équipement supprimé', 'success');
      },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  exportCSV(): void {
    const headers = ['ID', 'Nom', 'Type', 'Zone', 'Energie', 'Statut', 'Puissance'];
    const rows    = this.equipements.map(e =>
      [e.idEquipement, `"${e.nom}"`, `"${e.typeEquipement}"`, `"${e.zone?.nom ?? ''}"`,
       `"${e.energie?.nom ?? ''}"`, e.statut, e.puissance ?? ''].join(',')
    );
    this.downloadFile([headers.join(','), ...rows].join('\n'), 'equipements.csv', 'text/csv');
    this.showToast('Export CSV équipements généré', 'success');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MESURES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get filteredMesures(): Mesure[] {
    let result = [...this.mesures];
    if (this.searchMesure) {
      const q = this.searchMesure.toLowerCase();
      result  = result.filter(m =>
        (m.energie?.nom   ?? '').toLowerCase().includes(q) ||
        (m.sourceDonnee   ?? '').toLowerCase().includes(q) ||
        (m.equipement?.nom ?? '').toLowerCase().includes(q) ||
        String(m.valeur).includes(q)
      );
    }
    if      (this.sortMesure === 'Date — récent')            result.sort((a, b) => new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime());
    else if (this.sortMesure === 'Date — ancien')            result.sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    else if (this.sortMesure === 'Valeur — croissant')       result.sort((a, b) => a.valeur - b.valeur);
    else if (this.sortMesure === 'Valeur — décroissant')     result.sort((a, b) => b.valeur - a.valeur);
    return result;
  }

  get paginatedMesures(): Mesure[] {
    const start = (this.mesuresPage - 1) * this.mesuresPerPage;
    return this.filteredMesures.slice(start, start + this.mesuresPerPage);
  }

  get totalMesuresPages(): number {
    return Math.max(1, Math.ceil(this.filteredMesures.length / this.mesuresPerPage));
  }

  openNewMesure(): void {
    this.newMesure = {
      valeur:       0,
      dateMesure:   new Date().toISOString().slice(0, 16),
      sourceDonnee: '',
      energieId:    this.energies.length > 0 ? this.energies[0].idEnergie : undefined,
      equipementId: undefined
    };
    this.editingMesure   = null;
    this.showMesureModal = true;
  }

  editMesure(mesure: Mesure): void {
    this.editingMesure = { ...mesure };
    this.newMesure = {
      valeur:       mesure.valeur,
      dateMesure:   mesure.dateMesure ? mesure.dateMesure.slice(0, 16) : new Date().toISOString().slice(0, 16),
      sourceDonnee: mesure.sourceDonnee,
      energieId:    mesure.energieId,
      equipementId: mesure.equipementId
    };
    this.showMesureModal = true;
  }

  saveMesure(): void {
    if (this.newMesure.valeur === undefined || this.newMesure.valeur === null) { this.showToast('La valeur est requise', 'error'); return; }
    if (!this.newMesure.energieId)              { this.showToast("Veuillez sélectionner un type d'énergie", 'error'); return; }
    if (!this.newMesure.sourceDonnee?.trim())   { this.showToast('La source de donnée est requise', 'error'); return; }

    const payload = {
      valeur:       Number(this.newMesure.valeur),
      dateMesure:   this.newMesure.dateMesure ? new Date(this.newMesure.dateMesure).toISOString() : new Date().toISOString(),
      sourceDonnee: this.newMesure.sourceDonnee,
      energieId:    Number(this.newMesure.energieId),
      equipementId: this.newMesure.equipementId ? Number(this.newMesure.equipementId) : null
    };

    if (this.editingMesure) {
      const fullPayload = { ...this.editingMesure, ...payload };
      this.http.put(`${this.API}/Mesures/${this.editingMesure.idMesure}`, fullPayload).subscribe({
        next: () => { this.showMesureModal = false; this.editingMesure = null; this.reloadMesures(); this.showToast('Mesure modifiée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Mesure>(`${this.API}/Mesures`, payload).subscribe({
        next: () => { this.showMesureModal = false; this.reloadMesures(); this.showToast('Mesure créée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteMesure(id: number): void {
    if (!confirm('Supprimer cette mesure ?')) return;
    this.http.delete(`${this.API}/Mesures/${id}`).subscribe({
      next: () => { this.mesures = this.mesures.filter(m => m.idMesure !== id); this.refreshAfterChange(); this.showToast('Mesure supprimée', 'success'); },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  exportMesuresCSV(): void {
    const headers = ['#', 'Valeur', 'Unite', 'Energie', 'Niveau', 'Source', 'Equipement', 'Date'];
    const rows    = this.mesures.map((m, i) =>
      [i + 1, m.valeur, `"${m.energie?.unite ?? ''}"`, `"${m.energie?.nom ?? ''}"`,
       this.getNiveauLabel(m), `"${m.sourceDonnee}"`, `"${m.equipement?.nom ?? ''}"`, m.dateMesure].join(',')
    );
    this.downloadFile([headers.join(','), ...rows].join('\n'), 'mesures.csv', 'text/csv');
    this.showToast('Export CSV mesures généré', 'success');
  }

  getNiveau(m: Mesure): 'Faible' | 'Normale' | 'Elevee' {
    const max = this.consommationMax || 1;
    const pct = (m.valeur / max) * 100;
    if (pct >= 80) return 'Elevee';
    if (pct >= 40) return 'Normale';
    return 'Faible';
  }

  getNiveauLabel(m: Mesure): string { return this.getNiveau(m); }

  niveauBarWidth(valeur: number): number {
    return this.consommationMax ? Math.min((valeur / this.consommationMax) * 100, 100) : 0;
  }

  niveauBarClass(niveau: string): string {
    if (niveau === 'Elevee')  return 'red';
    if (niveau === 'Normale') return 'amber';
    return 'blue';
  }

  niveauChipClass(niveau: string): string {
    if (niveau === 'Elevee')  return 'chip chip--red';
    if (niveau === 'Normale') return 'chip chip--amber';
    return 'chip chip--blue';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ALERTES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  get alertesActives(): number  { return this.alertes.filter(a => isAlerteActive(a.statut)).length; }
  get alertesResolues(): number { return this.alertes.filter(a => isAlerteResolue(a.statut)).length; }

  get filteredAlertes(): Alerte[] {
    return this.alertes.filter(a => {
      const matchSearch = !this.searchAlerte ||
        (a.type    ?? '').toLowerCase().includes(this.searchAlerte.toLowerCase()) ||
        (a.message ?? '').toLowerCase().includes(this.searchAlerte.toLowerCase());
      const matchFiltre =
        this.filtreAlerte === 'Toutes' ||
        (this.filtreAlerte === 'Actives'  && isAlerteActive(a.statut))  ||
        (this.filtreAlerte === 'Résolues' && isAlerteResolue(a.statut));
      return matchSearch && matchFiltre;
    });
  }

  openNewAlerte(): void {
    this.newAlerte     = { type: '', message: '', statut: 'active', energieId: undefined, equipementId: undefined };
    this.editingAlerte = null;
    this.showAlerteModal = true;
  }

  editAlerte(alerte: Alerte): void {
    this.editingAlerte = { ...alerte };
    this.newAlerte = {
      type: alerte.type, message: alerte.message, statut: alerte.statut,
      energieId: alerte.energieId, equipementId: alerte.equipementId
    };
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

  deleteAlerte(id: number): void {
    if (!confirm('Supprimer cette alerte ?')) return;
    this.http.delete(`${this.API}/Alertes/${id}`).subscribe({
      next: () => { this.alertes = this.alertes.filter(a => a.idAlerte !== id); this.computeKPIs(); this.showToast('Alerte supprimée', 'success'); },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  resolveAlerte(alerte: Alerte): void {
    const payload = { ...alerte, statut: 'résolue' };
    this.http.put(`${this.API}/Alertes/${alerte.idAlerte}`, payload).subscribe({
      next: () => {
        const idx = this.alertes.findIndex(a => a.idAlerte === alerte.idAlerte);
        if (idx !== -1) this.alertes[idx].statut = 'résolue';
        this.computeKPIs();
        this.showToast('Alerte résolue', 'success');
      },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ANOMALIES
  // ══════════════════════════════════════════════════════════════════════════════

  get anomaliesActives():  number { return this.anomalies.filter(a => a.statut === 'active').length; }
  get anomaliesTraitees(): number { return this.anomalies.filter(a => a.statut === 'traitée').length; }

  get filteredAnomalies(): Anomalie[] {
    if (!this.searchAnomalie) return this.anomalies;
    const q = this.searchAnomalie.toLowerCase();
    return this.anomalies.filter(a =>
      (a.type    ?? '').toLowerCase().includes(q) ||
      (a.message ?? '').toLowerCase().includes(q)
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ÉNERGIES — CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  getEnergieEquipCount(energieId: number): number { return this.equipements.filter(e => e.energieId === energieId).length; }
  getEnergieMesureCount(energieId: number): number { return this.mesures.filter(m => m.energieId === energieId).length; }

  getEnergieConsommation(energieId: number): number {
    return Math.round(
      this.mesures.filter(m => m.energieId === energieId).reduce((s, m) => s + (Number(m.valeur) || 0), 0) * 100
    ) / 100;
  }

  get filteredEnergies(): Energie[] {
    if (!this.searchEnergie) return this.energies;
    const q = this.searchEnergie.toLowerCase();
    return this.energies.filter(e =>
      e.nom.toLowerCase().includes(q)              ||
      e.unite.toLowerCase().includes(q)            ||
      (e.description ?? '').toLowerCase().includes(q)
    );
  }

  getEnergieIcon(nom: string): string {
    const n = (nom ?? '').toLowerCase();
    if (n.includes('eau'))                           return '💧';
    if (n.includes('elec') || n.includes('électr')) return '⚡';
    if (n.includes('gas')  || n.includes('gasoil')) return '🛢️';
    if (n.includes('solaire') || n.includes('sol')) return '☀️';
    if (n.includes('gaz'))                          return '🔥';
    return '⚡';
  }

  getEnergieColor(energie: Energie): string {
    if (energie.couleur) return energie.couleur;
    const n = (energie.nom ?? '').toLowerCase();
    if (n.includes('eau'))                           return '#06b6d4';
    if (n.includes('elec') || n.includes('électr')) return '#6366f1';
    if (n.includes('gas')  || n.includes('gasoil')) return '#f59e0b';
    if (n.includes('solaire'))                      return '#eab308';
    return '#8b5cf6';
  }

  openNewEnergie(): void {
    this.newEnergie     = { nom: '', unite: '', description: '', facteurConversion: 1, couleur: '#6366f1' };
    this.editingEnergie = null;
    this.showEnergieModal = true;
  }

  editEnergie(energie: Energie): void {
    this.editingEnergie = { ...energie };
    this.newEnergie = {
      nom:               energie.nom,
      unite:             energie.unite,
      description:       energie.description,
      facteurConversion: energie.facteurConversion ?? 1,
      couleur:           energie.couleur ?? '#6366f1',
    };
    this.showEnergieModal = true;
  }

  saveEnergie(): void {
    if (!this.newEnergie.nom?.trim())   { this.showToast("Le nom de l'énergie est requis", 'error'); return; }
    if (!this.newEnergie.unite?.trim()) { this.showToast("L'unité est requise", 'error'); return; }

    if (this.editingEnergie) {
      const payload: Energie = { ...this.editingEnergie, ...this.newEnergie } as Energie;
      this.http.put(`${this.API}/Energies/${this.editingEnergie.idEnergie}`, payload).subscribe({
        next: () => { this.showEnergieModal = false; this.editingEnergie = null; this.reloadEnergies(); this.showToast('Énergie modifiée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    } else {
      this.http.post<Energie>(`${this.API}/Energies`, this.newEnergie).subscribe({
        next: () => { this.showEnergieModal = false; this.reloadEnergies(); this.showToast('Énergie créée avec succès', 'success'); },
        error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
      });
    }
  }

  deleteEnergie(id: number): void {
    const linked = this.equipements.filter(e => e.energieId === id).length;
    const msg = linked > 0
      ? `Cette énergie est liée à ${linked} équipement(s). Supprimer quand même ?`
      : 'Supprimer cette énergie ?';
    if (!confirm(msg)) return;
    this.http.delete(`${this.API}/Energies/${id}`).subscribe({
      next: () => { this.energies = this.energies.filter(e => e.idEnergie !== id); this.showToast('Énergie supprimée', 'success'); },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  exportEnergiesCSV(): void {
    const headers = ['ID', 'Nom', 'Unité', 'Description', 'Facteur conversion', 'Équipements', 'Mesures', 'Consommation totale'];
    const rows    = this.energies.map(e =>
      [e.idEnergie, `"${e.nom}"`, `"${e.unite}"`, `"${e.description ?? ''}"`,
       e.facteurConversion ?? 1, this.getEnergieEquipCount(e.idEnergie),
       this.getEnergieMesureCount(e.idEnergie), this.getEnergieConsommation(e.idEnergie)].join(',')
    );
    this.downloadFile([headers.join(','), ...rows].join('\n'), 'energies.csv', 'text/csv');
    this.showToast('Export CSV énergies généré', 'success');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PROFIL / MOT DE PASSE
  // ══════════════════════════════════════════════════════════════════════════════

  savePassword(): void {
    if (!this.motDePasseActuel || !this.nouveauMotDePasse || !this.confirmerMotDePasse) {
      this.showToast('Veuillez remplir tous les champs', 'error'); return;
    }
    if (this.nouveauMotDePasse.length < 6) {
      this.showToast('Le mot de passe doit avoir au moins 6 caractères', 'error'); return;
    }
    if (this.nouveauMotDePasse !== this.confirmerMotDePasse) {
      this.showToast('Les mots de passe ne correspondent pas', 'error'); return;
    }

    const user = this.auth.getCurrentUser();
    if (!user) return;

    this.http.post(`${this.API}/Auth/reset-password`, {
      email:       user.email,
      code:        this.motDePasseActuel,
      newPassword: this.nouveauMotDePasse
    }).subscribe({
      next: () => {
        this.showToast('Mot de passe modifié avec succès !', 'success');
        this.motDePasseActuel = this.nouveauMotDePasse = this.confirmerMotDePasse = '';
      },
      error: (e) => this.showToast('Erreur: ' + (e.error?.message || e.statusText), 'error')
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // IA / LLM
  // ══════════════════════════════════════════════════════════════════════════════

  get iaContext(): string {
    const top3 = [...this.mesures]
      .sort((a, b) => b.valeur - a.valeur)
      .slice(0, 3)
      .map(m => `${m.equipement?.nom ?? 'N/A'} (${m.valeur} ${m.energie?.unite ?? ''})`)
      .join(', ');

    const energiesSummary = this.energies
      .map(e => `${e.nom} (${e.unite}) — ${this.getEnergieMesureCount(e.idEnergie)} mesures, conso: ${this.getEnergieConsommation(e.idEnergie)}`)
      .join('; ');

    return `Tu es un assistant IA expert en gestion energetique pour la plateforme WICMIC EnergyTracker.
Donnees TEMPS REEL (${new Date().toLocaleDateString('fr-FR')}) :
- Sites industriels : ${this.totalSites}
- Equipements actifs : ${this.totalEquipements}
- Total mesures : ${this.mesures.length}
- Consommation totale : ${this.consommationTotale}
- Consommation moyenne : ${this.consommationMoyenne}
- Maximum releve : ${this.consommationMax}
- Minimum releve : ${this.consommationMin}
- Alertes actives : ${this.totalAlertes}
- Alertes resolues : ${this.alertesResolues}
- Sante systeme : ${this.santeSysteme}%
- Utilisateurs : ${this.totalUtilisateurs}
- Repartition : Electricite ${this.repartitionElec}%, Eau ${this.repartitionEau}%, Gasoil ${this.repartitionGasoil}%
- Top 3 consommateurs : ${top3 || 'N/A'}
- Energies configurees (${this.energies.length}) : ${energiesSummary || 'N/A'}
Reponds en francais, de maniere concise, professionnelle et structuree avec des bullet points si pertinent.`;
  }

  async sendIaMessage(text?: string): Promise<void> {
    const msg = text || this.iaInput.trim();
    if (!msg || this.iaLoading) return;

    this.iaInput   = '';
    this.iaLoading = true;
    this.iaTotalQuestions++;
    this.iaMessages.push({ role: 'user', content: msg, timestamp: this.currentTime });
    this.iaTotalMessages++;
    this.shouldScrollChat = true;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages:   [{ role: 'user', content: `${this.iaContext}\n\nQuestion: ${msg}` }]
        })
      });
      const data          = await response.json();
      const assistantText = data.content?.find((c: { type: string; text?: string }) => c.type === 'text')?.text
        ?? "Désolé, je n'ai pas pu traiter votre demande.";
      this.iaMessages.push({ role: 'assistant', content: assistantText, timestamp: this.currentTime });
      this.iaTotalMessages++;
    } catch {
      this.iaMessages.push({
        role:      'assistant',
        content:   'Erreur de connexion au service IA. Veuillez réessayer.',
        timestamp: this.currentTime
      });
      this.iaTotalMessages++;
    }

    this.iaLoading        = false;
    this.shouldScrollChat = true;
  }

  clearIaChat(): void {
    if (this.iaMessages.length > 0 && !confirm('Effacer toute la conversation ?')) return;
    this.iaMessages       = [];
    this.iaTotalMessages  = 0;
    this.iaTotalQuestions = 0;
  }

  exportIaChat(): void {
    if (this.iaMessages.length === 0) { this.showToast('Aucune conversation à exporter', 'info'); return; }
    const text = this.iaMessages
      .map(m => `[${m.timestamp}] ${m.role === 'user' ? 'Vous' : 'IA'}: ${m.content}`)
      .join('\n\n');
    this.downloadFile(text, `ia-conversation-${new Date().toISOString().split('T')[0]}.txt`, 'text/plain');
    this.showToast('Conversation exportée', 'success');
  }

  iaKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendIaMessage(); }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // EXPORT PDF
  // ══════════════════════════════════════════════════════════════════════════════

  async exportRapportPDF(type: string): Promise<void> {
    if (this.exportingPDF) return;
    this.exportingPDF = true;
    this.showToast(`Génération du PDF "${type}"...`, 'info');

    try {
      const jsPDF = await this.loadJsPDF();
      const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW  = doc.internal.pageSize.getWidth();
      const pageH  = doc.internal.pageSize.getHeight();
      const margin = 14;
      const usable = pageW - margin * 2;
      const C      = this.PDF_COLORS;
      const now    = new Date();

      let y = 34;

      const newPage = () => {
        doc.addPage();
        this.pdfPageHeader(doc, pageW, pageH, type, margin);
        y = 34;
      };
      const checkY = (needed: number) => { if (y + needed > pageH - 14) newPage(); };

      this.pdfPageHeader(doc, pageW, pageH, type, margin);

      this.pdfTxt(doc, 'Rapport Énergétique Global', margin, y, C.navy, 16, true);
      y += 5;
      this.pdfTxt(doc, `Opérateur : ${this.adminName}   |   ${this.platformName}`, margin, y, C.textMuted, 7.5);
      y += 4;
      this.pdfSetFill(doc, C.indigo);
      doc.rect(margin, y, usable, 1, 'F');
      y += 6;

      const kpis = [
        { label: 'Sites',         value: String(this.totalSites),        rgb: C.blue   },
        { label: 'Zones',         value: String(this.zonesCount),        rgb: C.indigo },
        { label: 'Equipements',   value: String(this.totalEquipements),  rgb: C.purple },
        { label: 'Mesures',       value: String(this.totalMesures),      rgb: C.amber  },
        { label: 'Alertes act.',  value: String(this.totalAlertes),      rgb: this.totalAlertes > 0 ? C.red : C.green },
        { label: 'Resolues',      value: String(this.alertesResolues),   rgb: C.green  },
        { label: 'Utilisateurs',  value: String(this.totalUtilisateurs), rgb: C.cyan   },
        { label: 'Sante systeme', value: `${this.santeSysteme}%`,        rgb: this.santeSysteme >= 80 ? C.green : C.red },
      ];

      const gap   = 3;
      const nCols = 4;
      const cardW = (usable - gap * (nCols - 1)) / nCols;
      const cardH = 22;

      [0, 4].forEach(offset => {
        kpis.slice(offset, offset + nCols).forEach((kpi, i) => {
          this.pdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, cardH, kpi.value, kpi.label, kpi.rgb);
        });
        y += cardH + gap;
      });
      y += 4;

      checkY(46);
      y = this.pdfSection(doc, 'CONSOMMATION ENERGETIQUE', 'Indicateurs', margin, y, usable);

      const consoItems = [
        { label: 'Consommation totale',  value: String(this.consommationTotale),  rgb: C.indigo },
        { label: 'Consommation moyenne', value: String(this.consommationMoyenne), rgb: C.blue   },
        { label: 'Maximum relevé',       value: String(this.consommationMax),     rgb: C.red    },
        { label: 'Minimum relevé',       value: String(this.consommationMin),     rgb: C.green  },
      ];
      const cW = (usable - gap) / 2;
      const cH = 12;
      consoItems.forEach((item, i) => {
        const cx = margin + (i % 2) * (cW + gap);
        const cy = y + Math.floor(i / 2) * (cH + 3);
        this.pdfRR(doc, cx, cy, cW, cH, C.grayBg, 2);
        this.pdfSetFill(doc, item.rgb);
        doc.rect(cx, cy, 3, cH, 'F');
        this.pdfTxt(doc, item.label, cx + 6, cy + 5,   C.textMuted, 7);
        this.pdfTxt(doc, item.value, cx + 6, cy + 9.5, item.rgb,    9, true);
      });
      y += (cH + 3) * 2 + 5;

      checkY(38);
      y = this.pdfSection(doc, 'REPARTITION ENERGETIQUE', '', margin, y, usable);
      const labelW = 24, pctW = 10, barW = usable - labelW - pctW - 4;
      [
        { label: 'Electricite', pct: this.repartitionElec,   rgb: C.blue  },
        { label: 'Eau',         pct: this.repartitionEau,    rgb: C.cyan  },
        { label: 'Gasoil',      pct: this.repartitionGasoil, rgb: C.amber },
      ].forEach(rep => {
        this.pdfTxt(doc, rep.label, margin, y + 4.5, C.textMain, 8, true);
        this.pdfBar(doc, margin + labelW, y, barW, rep.pct, rep.rgb);
        this.pdfTxt(doc, `${rep.pct}%`, margin + labelW + barW + 3, y + 4.5, rep.rgb, 7.5, true);
        y += 10;
      });
      y += 3;

      checkY(62);
      y = this.pdfSection(doc, 'EVOLUTION MENSUELLE', '7 derniers mois', margin, y, usable);
      this.pdfBarChart(doc, margin, y + 10, usable, 46);
      y += 64;

      newPage();
      this.pdfTxt(doc, 'Alertes & Mesures', margin, y, C.navy, 14, true);
      y += 7;

      y = this.pdfSection(doc, 'ALERTES SYSTEME',
        `${this.alertesActives} active(s) · ${this.alertesResolues} résolue(s)`, margin, y, usable, C.red);

      if (this.alertes.length === 0) {
        this.pdfRR(doc, margin, y, usable, 10, C.green, 2);
        this.pdfTxt(doc, 'Aucune alerte — Systeme nominal', pageW / 2, y + 7, C.white, 9, true, 'center');
        y += 15;
      } else {
        const alertH = [
          { title: 'TYPE',       w: 28 },
          { title: 'MESSAGE',    w: 68 },
          { title: 'STATUT',     w: 22 },
          { title: 'ENERGIE',    w: 26 },
          { title: 'EQUIPEMENT', w: 30 },
          { title: 'DATE',       w: usable - 174 },
        ];
        const alertR = this.alertes.slice(0, 25).map(a => [
          { text: a.type    ?? '—', bold: true },
          { text: a.message ?? '—' },
          {
            text:  isAlerteActive(a.statut) ? 'ACTIVE' : 'RESOLUE',
            badge: { rgb: isAlerteActive(a.statut) ? C.red : C.green }
          },
          { text: a.energie?.nom    ?? '—' },
          { text: a.equipement?.nom ?? '—' },
          { text: this.formatDateShort(a.dateCreation) },
        ]);
        y = this.pdfTable(doc, alertH, alertR, margin, y, pageW, pageH, margin, type, C.red);
        y += 6;
      }

      checkY(20);
      y = this.pdfSection(doc, 'DERNIERES MESURES',
        `${Math.min(this.mesures.length, 25)} sur ${this.totalMesures}`, margin, y, usable, C.amber);

      const mesH = [
        { title: '#',          w: 8,  align: 'center' as const },
        { title: 'VALEUR',     w: 22 },
        { title: 'UNITE',      w: 14 },
        { title: 'ENERGIE',    w: 28 },
        { title: 'NIVEAU',     w: 22, align: 'center' as const },
        { title: 'SOURCE',     w: 30 },
        { title: 'EQUIPEMENT', w: 32 },
        { title: 'DATE',       w: usable - 156 },
      ];

      const nRgb = (m: Mesure): [number, number, number] => {
        const n = this.getNiveau(m);
        if (n === 'Elevee')  return C.red;
        if (n === 'Normale') return C.amber;
        return C.blue;
      };

      const mesR = [...this.mesures]
        .sort((a, b) => new Date(b.dateMesure).getTime() - new Date(a.dateMesure).getTime())
        .slice(0, 25)
        .map((m, i) => [
          { text: String(i + 1),    align: 'center' as const },
          { text: String(m.valeur), bold: true },
          { text: m.energie?.unite ?? '—' },
          { text: m.energie?.nom   ?? '—' },
          { text: this.getNiveauLabel(m), badge: { rgb: nRgb(m) } },
          { text: m.sourceDonnee   ?? '—' },
          { text: m.equipement?.nom ?? '—' },
          { text: this.formatDateShort(m.dateMesure) },
        ]);

      y = this.pdfTable(doc, mesH, mesR, margin, y, pageW, pageH, margin, type, C.amber);

      newPage();
      this.pdfTxt(doc, 'Infrastructure & Utilisateurs', margin, y, C.navy, 14, true);
      y += 7;

      y = this.pdfSection(doc, 'SITES INDUSTRIELS', `${this.totalSites} sites`, margin, y, usable, C.blue);
      const siteH = [
        { title: 'ID',      w: 12, align: 'center' as const },
        { title: 'NOM',     w: 48 },
        { title: 'ADRESSE', w: 80 },
        { title: 'ZONES',   w: 22, align: 'center' as const },
        { title: 'EQUIP.',  w: usable - 162, align: 'center' as const },
      ];
      const siteR = this.sites.map(s => [
        { text: String(s.idSite), align: 'center' as const },
        { text: s.nom, bold: true },
        { text: s.adresse ?? '—' },
        { text: String(this.getSiteZonesCount(s.idSite)), badge: { rgb: C.indigo } },
        { text: String(this.getSiteEquipCount(s.idSite)), badge: { rgb: C.purple } },
      ]);
      y = this.pdfTable(doc, siteH, siteR, margin, y, pageW, pageH, margin, type, C.blue);
      y += 6;

      checkY(20);
      y = this.pdfSection(doc, 'COMPTES UTILISATEURS', `${this.totalUtilisateurs} compte(s)`, margin, y, usable, C.purple);

      const roleRgb = (role: string): [number, number, number] => {
        const r = role.toLowerCase();
        if (r.includes('admin'))                        return C.red;
        if (r.includes('electricite'))                  return C.blue;
        if (r.includes('eau'))                          return C.cyan;
        if (r.includes('gaz') || r.includes('gasoil')) return C.amber;
        if (r.includes('responsable'))                  return C.indigo;
        return C.green;
      };

      const userH = [
        { title: 'NOM COMPLET', w: 60 },
        { title: 'EMAIL',       w: 80 },
        { title: 'ROLE',        w: usable - 140, align: 'center' as const },
      ];
      const userR = this.utilisateurs.map(u => [
        { text: u.nom, bold: true },
        { text: u.email },
        { text: this.getRoleLabel(u.role), badge: { rgb: roleRgb(u.role) } },
      ]);
      y = this.pdfTable(doc, userH, userR, margin, y, pageW, pageH, margin, type, C.purple);

      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        this.pdfPageFooter(doc, pageW, pageH, margin, p, totalPages);
      }

      const dateFile = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;
      doc.save(`wicmic-rapport-${type.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${dateFile}.pdf`);
      this.showToast(`PDF "${type}" téléchargé !`, 'success');

    } catch (err) {
      console.error('Erreur PDF:', err);
      this.showToast('Erreur lors de la génération du PDF', 'error');
    }

    this.exportingPDF = false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PDF — helpers privés
  // ══════════════════════════════════════════════════════════════════════════════

  private async loadJsPDF(): Promise<any> {
    if (typeof (window as any).jspdf !== 'undefined') {
      return (window as any).jspdf.jsPDF;
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = () => {
        if ((window as any).jspdf?.jsPDF) resolve((window as any).jspdf.jsPDF);
        else reject(new Error('jsPDF introuvable après chargement'));
      };
      script.onerror = () => reject(new Error('Impossible de charger jsPDF'));
      document.head.appendChild(script);
    });
  }

  private pdfPageHeader(doc: any, pageW: number, _pageH: number, type: string, margin: number): void {
    const C = this.PDF_COLORS;
    this.pdfSetFill(doc, C.navy);
    doc.rect(0, 0, pageW, 14, 'F');
    this.pdfSetFill(doc, C.indigo);
    doc.rect(0, 14, pageW, 2, 'F');
    this.pdfTxt(doc, 'WICMIC EnergyTracker', margin, 9.5, C.white, 9, true);
    this.pdfTxt(doc, `Rapport : ${type}`, pageW / 2, 9.5, C.cyan, 8, false, 'center');
    this.pdfTxt(doc, new Date().toLocaleDateString('fr-FR'), pageW - margin, 9.5, C.white, 8, false, 'right');
  }

  private pdfPageFooter(doc: any, pageW: number, pageH: number, margin: number, page: number, total: number): void {
    const C = this.PDF_COLORS;
    this.pdfSetFill(doc, C.grayLine);
    doc.rect(margin, pageH - 10, pageW - margin * 2, 0.3, 'F');
    this.pdfTxt(doc, `${this.platformName}  —  Confidentiel`, margin, pageH - 5, C.textMuted, 6.5);
    this.pdfTxt(doc, `Page ${page} / ${total}`, pageW - margin, pageH - 5, C.textMuted, 6.5, false, 'right');
  }

  private pdfTxt(
    doc:   any,
    text:  string,
    x:     number,
    y:     number,
    rgb:   [number, number, number],
    size:  number,
    bold   = false,
    align: 'left' | 'center' | 'right' = 'left'
  ): void {
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(text ?? '', x, y, { align });
  }

  private pdfSetFill(doc: any, rgb: [number, number, number]): void {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  }

  private pdfRR(
    doc: any, x: number, y: number, w: number, h: number,
    rgb: [number, number, number], _r = 2
  ): void {
    this.pdfSetFill(doc, rgb);
    doc.rect(x, y, w, h, 'F');
  }

  private pdfKpiCard(
    doc:   any,
    x:     number,
    y:     number,
    w:     number,
    h:     number,
    value: string,
    label: string,
    rgb:   [number, number, number]
  ): void {
    const C = this.PDF_COLORS;
    this.pdfRR(doc, x, y, w, h, C.grayBg, 3);
    this.pdfSetFill(doc, rgb);
    doc.rect(x, y, w, 2.5, 'F');
    this.pdfTxt(doc, value, x + w / 2, y + 11, rgb, 14, true, 'center');
    this.pdfTxt(doc, label, x + w / 2, y + 18, C.textMuted, 6.5, false, 'center');
  }

  private pdfSection(
    doc:      any,
    title:    string,
    subtitle: string,
    x:        number,
    y:        number,
    w:        number,
    rgb:      [number, number, number] = this.PDF_COLORS.indigo
  ): number {
    const C = this.PDF_COLORS;
    this.pdfRR(doc, x, y, w, 8, C.grayBg, 2);
    this.pdfSetFill(doc, rgb);
    doc.rect(x, y, 3, 8, 'F');
    this.pdfTxt(doc, title, x + 6, y + 5.5, rgb, 8, true);
    if (subtitle) {
      this.pdfTxt(doc, subtitle, x + w, y + 5.5, C.textMuted, 7, false, 'right');
    }
    return y + 12;
  }

  private pdfBar(
    doc: any, x: number, y: number, maxW: number,
    pct: number, rgb: [number, number, number]
  ): void {
    const C   = this.PDF_COLORS;
    const h   = 8;
    const barW = Math.max(0, Math.min((pct / 100) * maxW, maxW));
    this.pdfRR(doc, x, y, maxW, h, C.grayBg, 2);
    if (barW > 0) {
      this.pdfSetFill(doc, rgb);
      doc.rect(x, y, barW, h, 'F');
    }
  }

  private pdfBarChart(doc: any, x: number, y: number, w: number, h: number): void {
    const C      = this.PDF_COLORS;
    const labels = this.chartData.labels;
    if (!labels.length) return;

    const maxVal = Math.max(
      ...this.chartData.electricite,
      ...this.chartData.eau,
      ...this.chartData.gasoil,
      1
    );

    const colW    = w / labels.length;
    const barW    = (colW - 4) / 3;
    const spacing = 1;

    labels.forEach((label, i) => {
      const cx = x + i * colW;
      const series = [
        { values: this.chartData.electricite, rgb: C.blue  },
        { values: this.chartData.eau,         rgb: C.cyan  },
        { values: this.chartData.gasoil,      rgb: C.amber },
      ];
      series.forEach((s, si) => {
        const val   = s.values[i] ?? 0;
        const bh    = Math.max(1, (val / maxVal) * h);
        const bx    = cx + si * (barW + spacing) + 1;
        const by    = y + h - bh;
        this.pdfSetFill(doc, s.rgb);
        doc.rect(bx, by, barW, bh, 'F');
      });
      this.pdfTxt(doc, label, cx + colW / 2, y + h + 5, C.textMuted, 6, false, 'center');
    });

    const legendY = y + h + 10;
    const legendItems = [
      { label: 'Électricité', rgb: C.blue  },
      { label: 'Eau',         rgb: C.cyan  },
      { label: 'Gasoil',      rgb: C.amber },
    ];
    legendItems.forEach((item, i) => {
      const lx = x + i * 45;
      this.pdfSetFill(doc, item.rgb);
      doc.rect(lx, legendY - 3, 6, 3, 'F');
      this.pdfTxt(doc, item.label, lx + 8, legendY, C.textMuted, 6.5);
    });
  }

  private pdfTable(
    doc:     any,
    headers: { title: string; w: number; align?: string }[],
    rows:    { text: string; bold?: boolean; align?: string; badge?: { rgb: [number, number, number] } }[][],
    x:       number,
    y:       number,
    pageW:   number,
    pageH:   number,
    margin:  number,
    type:    string,
    _accent: [number, number, number]
  ): number {
    const C      = this.PDF_COLORS;
    const rowH   = 7.5;
    const headH  = 8;

    const drawHeader = (yy: number) => {
      this.pdfSetFill(doc, C.navy);
      doc.rect(x, yy, headers.reduce((s, h) => s + h.w, 0), headH, 'F');
      let cx = x;
      headers.forEach(h => {
        this.pdfTxt(doc, h.title, cx + (h.align === 'center' ? h.w / 2 : 3), yy + 5.5,
          C.white, 6.5, true, (h.align as any) ?? 'left');
        cx += h.w;
      });
      return yy + headH;
    };

    y = drawHeader(y);

    rows.forEach((row, ri) => {
      if (y + rowH > pageH - 14) {
        doc.addPage();
        this.pdfPageHeader(doc, pageW, pageH, type, margin);
        y = 34;
        y = drawHeader(y);
      }

      if (ri % 2 === 0) {
        this.pdfSetFill(doc, C.grayBg);
        doc.rect(x, y, headers.reduce((s, h) => s + h.w, 0), rowH, 'F');
      }

      let cx = x;
      row.forEach((cell, ci) => {
        const col  = headers[ci];
        const text = String(cell.text ?? '');

        if (cell.badge) {
          const bw = Math.min(col.w - 4, 18);
          const bx = cx + (col.w - bw) / 2;
          this.pdfRR(doc, bx, y + 1.5, bw, rowH - 3, cell.badge.rgb, 2);
          this.pdfTxt(doc, text, bx + bw / 2, y + 5, C.white, 5.5, true, 'center');
        } else {
          const align = (cell.align ?? col.align ?? 'left') as 'left' | 'center' | 'right';
          const tx    = align === 'center' ? cx + col.w / 2 : align === 'right' ? cx + col.w - 2 : cx + 2;
          const maxChars = Math.floor(col.w / 1.8);
          const display  = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
          this.pdfTxt(doc, display, tx, y + 5, C.textMain, 6.5, cell.bold ?? false, align);
        }

        cx += col.w;
      });

      this.pdfSetFill(doc, C.grayLine);
      doc.rect(x, y + rowH - 0.2, headers.reduce((s, h) => s + h.w, 0), 0.2, 'F');

      y += rowH;
    });

    return y;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // EXPORT CSV
  // ══════════════════════════════════════════════════════════════════════════════

  exportRapportCSV(type: string): void {
    if (type === 'mesures') {
      this.exportMesuresCSV();
    } else if (type === 'energies') {
      this.exportEnergiesCSV();
    } else {
      const data = [
        'Indicateur,Valeur',
        `Sites,${this.totalSites}`,
        `Zones,${this.zonesCount}`,
        `Equipements,${this.totalEquipements}`,
        `Mesures,${this.mesures.length}`,
        `Alertes actives,${this.totalAlertes}`,
        `Alertes resolues,${this.alertesResolues}`,
        `Consommation totale,${this.consommationTotale}`,
        `Consommation moyenne,${this.consommationMoyenne}`,
        `Consommation max,${this.consommationMax}`,
        `Consommation min,${this.consommationMin}`,
        `Repartition Electricite,${this.repartitionElec}%`,
        `Repartition Eau,${this.repartitionEau}%`,
        `Repartition Gasoil,${this.repartitionGasoil}%`,
        `Utilisateurs,${this.totalUtilisateurs}`,
        `Sante systeme,${this.santeSysteme}%`,
        `Energies configurees,${this.energies.length}`,
      ].join('\n');
      this.downloadFile(data, 'synthese.csv', 'text/csv');
      this.showToast('Export CSV synthèse généré', 'success');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // HORLOGE
  // ══════════════════════════════════════════════════════════════════════════════

  updateClock(): void {
    const now    = new Date();
    const pad    = (n: number) => String(n).padStart(2, '0');
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
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    if (!type) return '⚙️';
    const t = type.toLowerCase();
    if (t.includes('textile') || t.includes('machine'))    return '🏭';
    if (t.includes('moteur')  || t.includes('électrique')) return '⚡';
    if (t.includes('pompe'))                               return '🔧';
    return '⚙️';
  }

  getEnergyIcon(energieNom: string): string {
    if (!energieNom) return '⚡';
    const n = energieNom.toLowerCase();
    if (n.includes('eau'))                           return '💧';
    if (n.includes('elec') || n.includes('électr')) return '⚡';
    if (n.includes('gas')  || n.includes('gasoil')) return '🛢️';
    return '⚡';
  }

  getEnergyIconFromObj(energie?: { nom: string }): string { return this.getEnergyIcon(energie?.nom ?? ''); }

  getEnergyClass(energieNom: string): string {
    if (!energieNom) return '';
    const n = energieNom.toLowerCase();
    if (n.includes('eau'))                           return 'energie-eau';
    if (n.includes('elec') || n.includes('électr')) return 'energie-elec';
    return 'energie-gasoil';
  }

  getEnergyClassFromObj(energie?: { nom: string }): string { return this.getEnergyClass(energie?.nom ?? ''); }

  getEnergyChipClass(energie?: { nom: string }): string {
    const nom = (energie?.nom ?? '').toLowerCase();
    if (nom.includes('eau'))                             return 'chip chip--cyan';
    if (nom.includes('elec') || nom.includes('électr')) return 'chip chip--amber';
    return 'chip chip--gray';
  }

  getTypeChipClass(type: string): string {
    const t = (type ?? '').toLowerCase();
    if (t.includes('textile') || t.includes('machine'))    return 'chip chip--purple';
    if (t.includes('moteur')  || t.includes('électrique')) return 'chip chip--blue';
    if (t.includes('pompe'))                               return 'chip chip--cyan';
    return 'chip chip--gray';
  }

  getStatutChipClass(statut: string): string {
    const s = (statut ?? '').toLowerCase();
    if (s.includes('actif')  || s.includes('en marche')) return 'chip chip--green';
    if (s.includes('arrêt')  || s.includes('inactif'))   return 'chip chip--red';
    return 'chip chip--amber';
  }

  getRoleClass(role: string): string {
    const r = (role ?? '').toLowerCase();
    if (r.includes('admin'))                              return 'role-admin';
    if (r.includes('responsable') || r.includes('resp')) return 'role-resp';
    return 'role-emp';
  }

  getRoleLabel(role: string): string {
    const r = (role ?? '').toLowerCase();
    if (r.includes('admin'))                                       return 'Admin';
    if (r.includes('electricite') || r.includes('électricite'))   return 'Resp. Électricité';
    if (r.includes('eau'))                                         return 'Resp. Eau';
    if (r.includes('gaz') || r.includes('gasoil'))                return 'Resp. Gasoil';
    if (r.includes('responsable') || r.includes('energie'))       return 'Resp. Énergie';
    return 'Employé';
  }

  getAdminInitial(): string { return this.adminName?.length > 0 ? this.adminName[0].toUpperCase() : '?'; }

  trackById(index: number, item: any): number {
    return item?.idUtilisateur
      ?? item?.idEquipement
      ?? item?.idMesure
      ?? item?.idAlerte
      ?? item?.idAnomalie
      ?? item?.idSite
      ?? item?.idZone
      ?? item?.idEnergie
      ?? index;
  }

  get chartMax(): number {
    const all = [...this.chartData.electricite, ...this.chartData.eau, ...this.chartData.gasoil];
    return all.length ? Math.max(...all) : 1;
  }

  barHeight(val: number): number { return Math.max(4, Math.round((val / this.chartMax) * 100)); }
}