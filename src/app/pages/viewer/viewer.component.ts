import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { ApiService }  from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { Mesure, Alerte, Equipement, Energie, Zone } from '../../core/api/api.models';

interface Site { idSite: number; nom: string; localisation?: string; }
interface ToastMsg { id: number; msg: string; type: 'success' | 'error' | 'info' | 'warn'; }

@Component({
  selector: 'app-employe',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './viewer.component.html',
  styleUrls: ['./viewer.component.css'],
})
export class ViewerComponent implements OnInit, OnDestroy {

  // ── Navigation ──────────────────────────────
  activeTab    = 'dashboard';
  navCollapsed = false;

  // ── State ────────────────────────────────────
  loading     = true;
  currentUser = this.auth.getCurrentUser();
  currentTime = new Date();
  isDarkMode  = false;
  private clockInterval: any;
  private toastCounter = 0;

  // ── Data ─────────────────────────────────────
  mesures:     Mesure[]     = [];
  alertes:     Alerte[]     = [];
  equipements: Equipement[] = [];
  energies:    Energie[]    = [];
  zones:       Zone[]       = [];
  sites:       Site[]       = [];
  toasts:      ToastMsg[]   = [];

  // ── Config ───────────────────────────────────
  energieColors = ['#2563eb', '#06b6d4', '#f97316', '#8b5cf6', '#22c55e', '#ef4444'];

  // ── Dates ────────────────────────────────────
  dateDebut = '';
  dateFin   = '';

  // ── Filtres alertes ──────────────────────────
  searchAlerte         = '';
  filterAlerteSeverite = '';
  filterAlerteStatut   = '';

  // ── Filtres équipements ──────────────────────
  searchEquip      = '';
  filterEquipType  = '';
  filterEquipStatut = '';

  // ── Pagination mesures ───────────────────────
  mesuresPage     = 1;
  mesuresPerPage  = 10;

  // ── Types équipements (auto-rempli) ──────────
  equipTypes: string[] = [];

  constructor(
    private api:  ApiService,
    private auth: AuthService,
  ) {}

  // ══════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════

  ngOnInit(): void {
    this.loadAll();
    this.clockInterval = setInterval(() => this.currentTime = new Date(), 1000);
    const now = new Date();
    const ago = new Date();
    ago.setMonth(ago.getMonth() - 1);
    this.dateFin   = now.toISOString().slice(0, 10);
    this.dateDebut = ago.toISOString().slice(0, 10);
  }

  ngOnDestroy(): void { clearInterval(this.clockInterval); }

  setTab(tab: string): void {
    this.activeTab = tab;
    this.mesuresPage = 1;
  }

  toggleDarkMode(): void {
    this.isDarkMode = !this.isDarkMode;
    document.body.classList.toggle('dark-mode', this.isDarkMode);
    this.showToast(this.isDarkMode ? 'Mode sombre activé' : 'Mode clair activé', 'info');
  }

  // ══════════════════════════════════════════
  // Data loading
  // ══════════════════════════════════════════

  loadAll(): void {
    this.loading = true;
    let done = 0;
    const total = 5;
    const check = () => { if (++done >= total) { this.loading = false; this.buildEquipTypes(); } };

    this.api.getMesures().subscribe({
      next:  d => { this.mesures = (d as any[]).map(m => this.normalizeMesure(m)); check(); },
      error: () => { this.showToast('Erreur chargement mesures', 'error'); check(); },
    });
    this.api.getAlertes().subscribe({
      next:  d => { this.alertes = d; check(); },
      error: () => { this.showToast('Erreur chargement alertes', 'error'); check(); },
    });
    this.api.getEquipements().subscribe({
      next:  d => { this.equipements = (d as any[]).map(e => this.normalizeEquipement(e)); check(); },
      error: () => check(),
    });
    this.api.getEnergies().subscribe({
      next:  d => { this.energies = (d as any[]).map(e => this.normalizeEnergie(e)); check(); },
      error: () => check(),
    });
    this.api.getZones().subscribe({
      next:  d => { this.zones = d; check(); this.extractSites(); },
      error: () => check(),
    });
  }

  private buildEquipTypes(): void {
    const types = new Set(this.equipements.map(e => e.typeEquipement).filter(Boolean));
    this.equipTypes = Array.from(types).sort();
  }

  private extractSites(): void {
    const map = new Map<number, Site>();
    this.zones.forEach((z: any) => {
      if (z.siteId && z.site)
        map.set(z.siteId, { idSite: z.siteId, nom: z.site.nom ?? `Site ${z.siteId}`, localisation: z.site.localisation });
    });
    this.equipements.forEach((e: any) => {
      if (e.zone?.siteId && !map.has(e.zone.siteId))
        map.set(e.zone.siteId, { idSite: e.zone.siteId, nom: e.zone.site?.nom ?? `Site ${e.zone.siteId}` });
    });
    this.sites = Array.from(map.values());
  }

  // ══════════════════════════════════════════
  // Normalisation
  // ══════════════════════════════════════════

  private normalizeEnergie(e: any): Energie {
    return { idEnergie: e.idEnergie ?? 0, nom: e.nom ?? '', unite: e.unite ?? '', dateCreation: e.dateCreation ?? '' } as Energie;
  }

  private normalizeMesure(m: any): Mesure {
    const eR = m.energie ?? m.Energie ?? null;
    const qR = m.equipement ?? m.Equipement ?? null;
    return {
      idMesure:     m.idMesure ?? 0,
      valeur:       +(m.valeur ?? 0),
      dateMesure:   m.dateMesure ?? new Date().toISOString(),
      dateCreation: m.dateCreation ?? new Date().toISOString(),
      sourceDonnee: m.sourceDonnee ?? '',
      energieId:    m.energieId ?? eR?.idEnergie ?? 0,
      energie:      eR ? this.normalizeEnergie(eR) : null,
      equipementId: m.equipementId ?? qR?.idEquipement ?? null,
      equipement:   qR ?? null,
      commentaire:  m.commentaire ?? '',
    } as Mesure;
  }

  private normalizeEquipement(e: any): Equipement {
    return {
      idEquipement:      e.idEquipement ?? 0,
      nom:               e.nom ?? '',
      typeEquipement:    e.typeEquipement ?? '',
      statut:            e.statut ?? 'Actif',
      puissance:         +(e.puissance ?? 0),
      localisation:      e.localisation ?? '',
      dateMiseEnService: e.dateMiseEnService ?? null,
      dateInstallation:  e.dateInstallation ?? null,
      energieId:         e.energieId ?? null,
      zoneId:            e.zoneId ?? null,
      energie:           e.energie ?? null,
      zone:              e.zone ?? null,
    } as Equipement;
  }

  // ══════════════════════════════════════════
  // KPIs
  // ══════════════════════════════════════════

  get totalSites():   number { return this.sites.length; }
  get totalZones():   number { return this.zones.length; }
  get totalMesures(): number { return this.mesures.length; }

  get alertesActives():   number { return this.alertes.filter(a => !a.traite).length; }
  get alertesCritiques(): number { return this.alertes.filter(a => !a.traite && a.severite === 'Critique').length; }
  get alertesHautes():    number { return this.alertes.filter(a => !a.traite && a.severite === 'Haute').length; }

  get consommationTotale(): number { return +(this.mesures.reduce((s, m) => s + m.valeur, 0).toFixed(1)); }
  get moyenneMesures():     number { return this.mesures.length ? +(this.consommationTotale / this.mesures.length).toFixed(1) : 0; }
  get maxMesure():          number { return this.mesures.length ? +Math.max(...this.mesures.map(m => m.valeur)).toFixed(1) : 0; }
  get minMesure():          number { return this.mesures.length ? +Math.min(...this.mesures.map(m => m.valeur)).toFixed(1) : 0; }

  get equipementsActifs():      number { return this.equipements.filter(e => !e.statut || e.statut === 'Actif').length; }
  get equipementsMaintenance(): number { return this.equipements.filter(e => e.statut === 'Maintenance').length; }
  get equipementsInactifs():    number { return this.equipements.filter(e => e.statut === 'Inactif').length; }
  get puissanceTotale():        number { return +this.equipements.reduce((s, e) => s + (e.puissance || 0), 0).toFixed(1); }

  get tendance(): 'up' | 'down' | 'stable' {
    if (this.mesures.length < 2) return 'stable';
    const sorted = [...this.mesures].sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime());
    const last = sorted[sorted.length - 1].valeur;
    const prev = sorted[sorted.length - 2].valeur;
    if (last > prev * 1.05) return 'up';
    if (last < prev * 0.95) return 'down';
    return 'stable';
  }

  // ══════════════════════════════════════════
  // Sparkline (mini graphe SVG)
  // ══════════════════════════════════════════

  getSparklinePath(values: number[]): string {
    if (!values.length) return '';
    const w = 120, h = 36;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    });
    return `M ${pts.join(' L ')}`;
  }

  getSparklineArea(values: number[]): string {
    if (!values.length) return '';
    const w = 120, h = 36;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    });
    return `M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`;
  }

  get lastMesuresValues(): number[] {
    return [...this.mesures]
      .sort((a, b) => new Date(a.dateMesure).getTime() - new Date(b.dateMesure).getTime())
      .slice(-12).map(m => m.valeur);
  }

  // ══════════════════════════════════════════
  // Helpers énergie
  // ══════════════════════════════════════════

  getEnergieTotal(id: number): number {
    return +(this.mesures.filter(m => Number(m.energieId) === Number(id)).reduce((s, m) => s + m.valeur, 0).toFixed(1));
  }
  getEnergiePct(id: number): number {
    return Math.round((this.getEnergieTotal(id) / (this.consommationTotale || 1)) * 100);
  }
  getEnergieNom(id: number): string {
    return this.energies.find(e => Number(e.idEnergie) === Number(id))?.nom ?? `Énergie ${id}`;
  }
  getEnergieUnite(id: number): string {
    return this.energies.find(e => Number(e.idEnergie) === Number(id))?.unite ?? 'unité';
  }
  getEnergieIcon(id: number): string {
    const n = this.getEnergieNom(id).toLowerCase();
    if (n.includes('elec') || n.includes('électr')) return '⚡';
    if (n.includes('eau')  || n.includes('water'))  return '💧';
    if (n.includes('gaz')  || n.includes('gasoil')) return '🛢️';
    return '🔋';
  }

  // ══════════════════════════════════════════
  // Filtres alertes
  // ══════════════════════════════════════════

  get filteredAlertes(): Alerte[] {
    let list = [...this.alertes];
    if (this.searchAlerte) {
      const q = this.searchAlerte.toLowerCase();
      list = list.filter(a => a.message?.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q));
    }
    if (this.filterAlerteSeverite) list = list.filter(a => a.severite === this.filterAlerteSeverite);
    if (this.filterAlerteStatut === 'active')  list = list.filter(a => !a.traite);
    if (this.filterAlerteStatut === 'traitee') list = list.filter(a =>  a.traite);
    return list;
  }

  // ══════════════════════════════════════════
  // Filtres équipements
  // ══════════════════════════════════════════

  get filteredEquipements(): Equipement[] {
    let list = [...this.equipements];
    if (this.searchEquip) {
      const q = this.searchEquip.toLowerCase();
      list = list.filter(e => e.nom?.toLowerCase().includes(q) || e.typeEquipement?.toLowerCase().includes(q) || e.localisation?.toLowerCase().includes(q));
    }
    if (this.filterEquipType)   list = list.filter(e => e.typeEquipement === this.filterEquipType);
    if (this.filterEquipStatut) list = list.filter(e => (e.statut || 'Actif') === this.filterEquipStatut);
    return list;
  }

  // ══════════════════════════════════════════
  // Pagination mesures
  // ══════════════════════════════════════════

  get mesuresPaged(): Mesure[] {
    const start = (this.mesuresPage - 1) * this.mesuresPerPage;
    return this.mesures.slice(start, start + this.mesuresPerPage);
  }

  get mesuresTotalPages(): number {
    return Math.max(1, Math.ceil(this.mesures.length / this.mesuresPerPage));
  }

  get mesuresPagesArray(): number[] {
    const pages: number[] = [];
    const total = this.mesuresTotalPages;
    const cur = this.mesuresPage;
    for (let i = Math.max(1, cur - 2); i <= Math.min(total, cur + 2); i++) pages.push(i);
    return pages;
  }

  goToPage(p: number): void {
    if (p >= 1 && p <= this.mesuresTotalPages) this.mesuresPage = p;
  }

  // ══════════════════════════════════════════
  // Helpers équipements
  // ══════════════════════════════════════════

  getEquipIcon(type: string): string {
    const icons: Record<string, string> = {
      Compresseur: '⚙️', Pompe: '💧', CVC: '❄️', Chaudière: '🔥',
      Éclairage: '💡', Générateur: '⚡', Moteur: '🔧',
      'Machine textile': '🧵', 'Machine packaging': '📦', Autre: '🔌',
    };
    return icons[type] || '🔌';
  }

  getEquipStatutClass(statut?: string): string {
    if (!statut || statut === 'Actif') return 'tag-g';
    if (statut === 'Maintenance')      return 'tag-w';
    return 'tag-r';
  }

  getEquipAge(e: Equipement): string {
    const ref = (e as any).dateMiseEnService || e.dateInstallation;
    if (!ref) return '—';
    const ans = Math.floor((Date.now() - new Date(ref).getTime()) / (365.25 * 86400000));
    return ans < 1 ? '< 1 an' : `${ans} an${ans > 1 ? 's' : ''}`;
  }

  getMesuresCount(equipId: number): number {
    return this.mesures.filter(m => Number(m.equipementId) === Number(equipId)).length;
  }

  // ══════════════════════════════════════════
  // Helpers sites & zones
  // ══════════════════════════════════════════

  getZonesBySite(siteId: number): Zone[] {
    return this.zones.filter((z: any) => Number(z.siteId) === Number(siteId));
  }
  getEquipBySite(siteId: number): Equipement[] {
    const zIds = this.getZonesBySite(siteId).map(z => z.idZone);
    return this.equipements.filter(e => zIds.includes(e.zoneId as number));
  }
  getEquipByZone(zoneId: number): Equipement[] {
    return this.equipements.filter(e => Number(e.zoneId) === Number(zoneId));
  }
  getMesuresBySite(siteId: number): number {
    const eIds = this.getEquipBySite(siteId).map(e => e.idEquipement);
    return this.mesures.filter(m => eIds.includes(Number(m.equipementId))).length;
  }
  getMesuresByZone(zoneId: number): number {
    const eIds = this.getEquipByZone(zoneId).map(e => e.idEquipement);
    return this.mesures.filter(m => eIds.includes(Number(m.equipementId))).length;
  }

  // ══════════════════════════════════════════
  // Exports
  // ══════════════════════════════════════════

  exportMesuresCSV(): void {
    if (!this.mesures.length) { this.showToast('Aucune mesure à exporter.', 'warn'); return; }
    const headers = ['ID', 'Valeur', 'Énergie', 'Unité', 'Source', 'Équipement', 'Date'];
    const rows = this.mesures.map(m => [
      m.idMesure, m.valeur,
      this.getEnergieNom(m.energieId), this.getEnergieUnite(m.energieId),
      m.sourceDonnee, m.equipement?.nom || '—',
      new Date(m.dateMesure).toLocaleString('fr-FR'),
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `mesures_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    this.showToast('Export CSV téléchargé !', 'success');
  }

  downloadRapport(type: string): void {
    switch (type) {
      case 'consommation': this.exportRapportConso(); break;
      case 'alertes':      this.exportRapportAlertes(); break;
      case 'equipements':  this.exportRapportEquips(); break;
      case 'csv':          this.exportMesuresCSV(); break;
      case 'sites':        this.exportRapportSites(); break;
    }
  }

  private exportRapportConso(): void {
    const lines = [
      'WICMIC — RAPPORT DE CONSOMMATION ÉNERGÉTIQUE',
      '='.repeat(55),
      `Date de génération : ${new Date().toLocaleString('fr-FR')}`,
      `Utilisateur : ${this.currentUser?.nom ?? '—'}`,
      `Période analysée : ${this.dateDebut} → ${this.dateFin}`,
      '-'.repeat(55),
      '',
      '📊 RÉSUMÉ GLOBAL',
      `  Total mesures      : ${this.totalMesures}`,
      `  Consommation totale: ${this.consommationTotale}`,
      `  Valeur moyenne     : ${this.moyenneMesures}`,
      `  Valeur maximale    : ${this.maxMesure}`,
      `  Valeur minimale    : ${this.minMesure}`,
      `  Tendance           : ${this.tendance === 'up' ? '↑ HAUSSE' : this.tendance === 'down' ? '↓ BAISSE' : '→ STABLE'}`,
      '',
      '⚡ RÉPARTITION PAR ÉNERGIE',
      '-'.repeat(55),
      ...this.energies.map(en =>
        `  ${en.nom.padEnd(22)} ${String(this.getEnergieTotal(en.idEnergie)).padStart(10)} ${en.unite}  (${this.getEnergiePct(en.idEnergie)}%)`
      ),
      '',
      '🏭 INFRASTRUCTURE',
      '-'.repeat(55),
      `  Sites industriels  : ${this.totalSites}`,
      `  Zones actives      : ${this.totalZones}`,
      `  Équipements totaux : ${this.equipements.length}`,
      `    Actifs           : ${this.equipementsActifs}`,
      `    En maintenance   : ${this.equipementsMaintenance}`,
      `    Inactifs         : ${this.equipementsInactifs}`,
      `  Puissance totale   : ${this.puissanceTotale} kW`,
      '',
      `Rapport généré par WICMIC EnergyTracker v1`,
    ];
    this.download(lines.join('\n'), `rapport_conso_${new Date().toISOString().slice(0,10)}.txt`, 'text/plain');
    this.showToast('Rapport consommation téléchargé !', 'success');
  }

  private exportRapportAlertes(): void {
    const headers = ['ID', 'Sévérité', 'Type', 'Message', 'Date', 'Statut'];
    const rows = this.alertes.map(a => [
      a.idAlerte, a.severite, a.type, `"${a.message}"`,
      new Date(a.dateCreation).toLocaleString('fr-FR'),
      a.traite ? 'Traitée' : 'Active',
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `alertes_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    this.showToast('Rapport alertes téléchargé !', 'success');
  }

  private exportRapportEquips(): void {
    const headers = ['ID', 'Nom', 'Type', 'Statut', 'Puissance (kW)', 'Zone', 'Site', 'Âge', 'Mesures'];
    const rows = this.equipements.map(e => [
      e.idEquipement, `"${e.nom}"`, e.typeEquipement, e.statut || 'Actif',
      e.puissance || '—', e.zone?.nom || '—',
      e.zone?.siteId ? this.sites.find(s => s.idSite === (e as any).zone?.siteId)?.nom || '—' : '—',
      this.getEquipAge(e), this.getMesuresCount(e.idEquipement),
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `equipements_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    this.showToast('Rapport équipements téléchargé !', 'success');
  }

  private exportRapportSites(): void {
    const headers = ['Site', 'Localisation', 'Zones', 'Équipements', 'Mesures'];
    const rows = this.sites.map(s => [
      `"${s.nom}"`, s.localisation || '—',
      this.getZonesBySite(s.idSite).length,
      this.getEquipBySite(s.idSite).length,
      this.getMesuresBySite(s.idSite),
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
    this.download('\uFEFF' + csv, `sites_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    this.showToast('Rapport sites téléchargé !', 'success');
  }

  private download(content: string, filename: string, type: string): void {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════
  // Toasts
  // ══════════════════════════════════════════

  showToast(msg: string, type: 'success' | 'error' | 'info' | 'warn'): void {
    const id = ++this.toastCounter;
    this.toasts.unshift({ id, msg, type });
    setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 4000);
  }

  dismissToast(id: number): void { this.toasts = this.toasts.filter(t => t.id !== id); }

  logout(): void { this.auth.logout(); }
}