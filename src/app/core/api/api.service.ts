import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { timeout, catchError, switchMap, tap } from 'rxjs/operators';

import {
  Mesure, Alerte, Anomalie, Recommandation,
  Equipement, Site, Zone, Utilisateur,
  CreateMesureDto, Rapport, AnalyseEnergetique,
  Notification, Energie
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {

  private BASE    = 'https://localhost:7128/api';
  private RAG_URL = 'http://localhost:8000';

  constructor(private http: HttpClient) {}

  // ── helpers internes ──────────────────────────────────────────────────────

  private get<T>(path: string): Observable<T[]> {
    return this.http.get<T[]>(`${this.BASE}/${path}`, { headers: this.getHeaders() }).pipe(
      catchError(err => { console.error(`GET /${path}`, err); return of([] as T[]); })
    );
  }

  private getOne<T>(path: string): Observable<T | null> {
    return this.http.get<T>(`${this.BASE}/${path}`, { headers: this.getHeaders() }).pipe(
      catchError(err => { console.error(`GET /${path}`, err); return of(null); })
    );
  }

  private post<T>(path: string, body: any): Observable<T> {
    return this.http.post<T>(`${this.BASE}/${path}`, body, { headers: this.getHeaders() }).pipe(
      tap({ error: err => console.error(`POST /${path}`, err) })
    );
  }

  private put<T>(path: string, body: any): Observable<T> {
    return this.http.put<T>(`${this.BASE}/${path}`, body, { headers: this.getHeaders() }).pipe(
      tap({ error: err => console.error(`PUT /${path}`, err) })
    );
  }

  private delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.BASE}/${path}`, { headers: this.getHeaders() }).pipe(
      tap({ error: err => console.error(`DELETE /${path}`, err) })
    );
  }

  private getHeaders(): HttpHeaders {
    const token = localStorage.getItem('wicmic_token') ?? '';
    return new HttpHeaders({
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    });
  }

  // ════════════════════════════════════════════
  // MESURES
  // ════════════════════════════════════════════

  getMesures(): Observable<Mesure[]> { return this.get<Mesure>('Mesures'); }
  getMesure(id: number): Observable<Mesure | null> { return this.getOne<Mesure>(`Mesures/${id}`); }

  getMesuresByEnergie(energieId: number): Observable<Mesure[]> {
    return this.http.get<Mesure[]>(
      `${this.BASE}/Mesures?energieId=${energieId}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(err => { console.error('GET Mesures by energieId', err); return of([]); })
    );
  }

  getMesuresByEnergieNom(nom: string): Observable<Mesure[]> {
    return this.http.get<Mesure[]>(
      `${this.BASE}/Mesures/byEnergie/${encodeURIComponent(nom)}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(err => { console.error(`GET Mesures/byEnergie/${nom}`, err); return of([]); })
    );
  }

  createMesure(dto: CreateMesureDto): Observable<Mesure> { return this.post<Mesure>('Mesures', dto); }
  updateMesure(id: number, dto: any): Observable<Mesure> { return this.put<Mesure>(`Mesures/${id}`, dto); }
  deleteMesure(id: number): Observable<any>              { return this.delete(`Mesures/${id}`); }

  // ════════════════════════════════════════════
  // SEUILS
  // ════════════════════════════════════════════

  getSeuils(): Observable<any[]> {
    return this.http.get<any[]>(`${this.BASE}/seuil`, { headers: this.getHeaders() }).pipe(
      catchError(err => { console.error('GET /seuil', err); return of([]); })
    );
  }

  getSeuilByEnergie(energieId: number): Observable<any | null> {
    return this.http.get<any>(
      `${this.BASE}/seuil/energie/${energieId}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(err => { console.error(`GET /seuil/energie/${energieId}`, err); return of(null); })
    );
  }

  getSeuilByEnergieNom(nom: string): Observable<any | null> {
    return this.getEnergieByNom(nom).pipe(
      switchMap(energie => {
        if (!energie) {
          console.warn(`getSeuilByEnergieNom: aucune énergie trouvée pour '${nom}'`);
          return of(null);
        }
        return this.getSeuilByEnergie(energie.idEnergie);
      }),
      catchError(err => { console.error(`getSeuilByEnergieNom(${nom})`, err); return of(null); })
    );
  }

  createSeuil(dto: { energieId: number; valeur: number; periode: string }): Observable<any> {
    return this.http.post<any>(`${this.BASE}/seuil`, dto, { headers: this.getHeaders() }).pipe(
      tap({ error: err => console.error('POST /seuil', err) })
    );
  }

  updateSeuil(
    energieId: number,
    dto: { energieId: number; valeur: number; periode: string }
  ): Observable<any> {
    return this.http.put<any>(
      `${this.BASE}/seuil/energie/${energieId}`,
      dto,
      { headers: this.getHeaders() }
    ).pipe(
      tap({ error: err => console.error(`PUT /seuil/energie/${energieId}`, err) })
    );
  }

  upsertSeuil(dto: { energieId: number; valeur: number; periode: string }): Observable<any> {
    return this.getSeuilByEnergie(dto.energieId).pipe(
      switchMap(existing => {
        if (existing && (existing.idSeuil || existing.IdSeuil)) {
          return this.updateSeuil(dto.energieId, dto);
        }
        return this.createSeuil(dto);
      })
    );
  }

  deleteSeuilByEnergie(energieId: number): Observable<any> {
    return this.http.delete<any>(
      `${this.BASE}/seuil/energie/${energieId}`,
      { headers: this.getHeaders() }
    ).pipe(
      tap({ error: err => console.error(`DELETE /seuil/energie/${energieId}`, err) })
    );
  }

  // ════════════════════════════════════════════
  // ALERTES
  // ════════════════════════════════════════════

  getAlertes(): Observable<Alerte[]>                          { return this.get<Alerte>('Alertes'); }
  getAlerte(id: number): Observable<Alerte | null>            { return this.getOne<Alerte>(`Alertes/${id}`); }
  createAlerte(dto: any): Observable<Alerte>                  { return this.post<Alerte>('Alertes', dto); }
  updateAlerte(id: number, dto: any): Observable<Alerte>      { return this.put<Alerte>(`Alertes/${id}`, dto); }
  deleteAlerte(id: number): Observable<any>                   { return this.delete(`Alertes/${id}`); }

  // ════════════════════════════════════════════
  // ANOMALIES
  // ════════════════════════════════════════════

  getAnomalies(): Observable<Anomalie[]>                      { return this.get<Anomalie>('Anomalies'); }
  getAnomalie(id: number): Observable<Anomalie | null>        { return this.getOne<Anomalie>(`Anomalies/${id}`); }
  createAnomalie(dto: any): Observable<Anomalie>              { return this.post<Anomalie>('Anomalies', dto); }
  updateAnomalie(id: number, dto: any): Observable<Anomalie>  { return this.put<Anomalie>(`Anomalies/${id}`, dto); }
  deleteAnomalie(id: number): Observable<any>                 { return this.delete(`Anomalies/${id}`); }

  // ════════════════════════════════════════════
  // RECOMMANDATIONS
  // ════════════════════════════════════════════

  getRecommandations(): Observable<Recommandation[]>                        { return this.get<Recommandation>('Recommandation'); }
  getRecommandation(id: number): Observable<Recommandation | null>          { return this.getOne<Recommandation>(`Recommandation/${id}`); }
  createRecommandation(dto: any): Observable<Recommandation>                { return this.post<Recommandation>('Recommandation', dto); }
  updateRecommandation(id: number, dto: any): Observable<Recommandation>    { return this.put<Recommandation>(`Recommandation/${id}`, dto); }
  deleteRecommandation(id: number): Observable<any>                         { return this.delete(`Recommandation/${id}`); }

  // ════════════════════════════════════════════
  // EQUIPEMENTS
  // ════════════════════════════════════════════

  getEquipements(): Observable<Equipement[]>                        { return this.get<Equipement>('Equipements'); }
  getEquipement(id: number): Observable<Equipement | null>          { return this.getOne<Equipement>(`Equipements/${id}`); }
  createEquipement(dto: any): Observable<Equipement>                { return this.post<Equipement>('Equipements', dto); }
  updateEquipement(id: number, dto: any): Observable<Equipement>    { return this.put<Equipement>(`Equipements/${id}`, dto); }
  deleteEquipement(id: number): Observable<any>                     { return this.delete(`Equipements/${id}`); }

  // ════════════════════════════════════════════
  // SITES
  // ════════════════════════════════════════════

  getSites(): Observable<Site[]>                      { return this.get<Site>('Sites'); }
  getSite(id: number): Observable<Site | null>        { return this.getOne<Site>(`Sites/${id}`); }
  createSite(dto: any): Observable<Site>              { return this.post<Site>('Sites', dto); }
  updateSite(id: number, dto: any): Observable<Site>  { return this.put<Site>(`Sites/${id}`, dto); }
  deleteSite(id: number): Observable<any>             { return this.delete(`Sites/${id}`); }

  // ════════════════════════════════════════════
  // ZONES
  // ════════════════════════════════════════════

  getZones(): Observable<Zone[]>                      { return this.get<Zone>('Zones'); }
  getZone(id: number): Observable<Zone | null>        { return this.getOne<Zone>(`Zones/${id}`); }
  createZone(dto: any): Observable<Zone>              { return this.post<Zone>('Zones', dto); }
  updateZone(id: number, dto: any): Observable<Zone>  { return this.put<Zone>(`Zones/${id}`, dto); }
  deleteZone(id: number): Observable<any>             { return this.delete(`Zones/${id}`); }

  // ════════════════════════════════════════════
  // UTILISATEURS
  // ════════════════════════════════════════════

  getUtilisateurs(): Observable<Utilisateur[]>                        { return this.get<Utilisateur>('Utilisateurs'); }
  getUtilisateur(id: number): Observable<Utilisateur | null>          { return this.getOne<Utilisateur>(`Utilisateurs/${id}`); }
  createUtilisateur(dto: any): Observable<Utilisateur>                { return this.post<Utilisateur>('Utilisateurs', dto); }
  updateUtilisateur(id: number, dto: any): Observable<Utilisateur>    { return this.put<Utilisateur>(`Utilisateurs/${id}`, dto); }
  deleteUtilisateur(id: number): Observable<any>                      { return this.delete(`Utilisateurs/${id}`); }

  // ════════════════════════════════════════════
  // ENERGIES
  // ════════════════════════════════════════════

  getEnergies(): Observable<Energie[]> { return this.get<Energie>('Energies'); }
  getEnergie(id: number): Observable<Energie | null> { return this.getOne<Energie>(`Energies/${id}`); }

  getEnergieByNom(nom: string): Observable<Energie | null> {
    return this.http.get<Energie>(
      `${this.BASE}/Energies/byNom/${encodeURIComponent(nom)}`,
      { headers: this.getHeaders() }
    ).pipe(
      catchError(err => { console.error(`GET Energies/byNom/${nom}`, err); return of(null); })
    );
  }

  // ════════════════════════════════════════════
  // RAPPORTS
  // ════════════════════════════════════════════

  getRapports(): Observable<Rapport[]>              { return this.get<Rapport>('Rapport'); }
  createRapport(dto: any): Observable<Rapport>      { return this.post<Rapport>('Rapport', dto); }

  // ════════════════════════════════════════════
  // ANALYSE ENERGETIQUE
  // ════════════════════════════════════════════

  getAnalyses(): Observable<AnalyseEnergetique[]>         { return this.get<AnalyseEnergetique>('AnalyseEnergetique'); }
  createAnalyse(dto: any): Observable<AnalyseEnergetique> { return this.post<AnalyseEnergetique>('AnalyseEnergetique', dto); }

  // ════════════════════════════════════════════
  // NOTIFICATIONS
  // ════════════════════════════════════════════

  getNotifications(): Observable<Notification[]> { return this.get<Notification>('Notifications'); }

  // ════════════════════════════════════════════
  // STATISTIQUES
  // ════════════════════════════════════════════

  getStatistiques(): Observable<any> {
    return this.http.get<any>(`${this.BASE}/Statistiques`, { headers: this.getHeaders() }).pipe(
      catchError(() => of(null))
    );
  }

  // ════════════════════════════════════════════
  // OLLAMA — IA CHAT  ← FastAPI RAG en priorité
  // ════════════════════════════════════════════

  ollamaChat(prompt: string): Observable<{ response: string }> {
    // ── 1. FastAPI RAG (http://localhost:8000/chat) ───────────────────────
    return this.http.post<{ response: string }>(
      `${this.RAG_URL}/chat`,
      { prompt, context: '' }
    ).pipe(
      timeout(300000),
      catchError(() => {
        // ── 2. Fallback backend .NET original ────────────────────────────
        const systemPrompt =
          `Tu es un assistant expert en gestion énergétique industrielle pour WICMIC (industrie textile en Tunisie).
RÈGLES ABSOLUES :
1. Tu réponds TOUJOURS en français, sans exception.
2. Tu es concis et précis (maximum 5-6 phrases).
3. Tu utilises les unités : kWh pour l'électricité, m³ pour l'eau et le gaz, DT pour les coûts.
4. Si tu ne sais pas, dis-le clairement en français.
5. Ne réponds JAMAIS en anglais ou dans une autre langue.

${prompt}`;

        return this.http.post<{ response: string }>(
          `${this.BASE}/Ollama/chat`,
          { prompt: systemPrompt },
          { headers: this.getHeaders() }
        ).pipe(
          timeout(300000),
          catchError(err => {
            if (err?.name === 'TimeoutError') {
              return of({ response: '⏳ Délai dépassé. Le modèle est en cours de chargement — réessayez dans 30 secondes.' });
            }
            const msg = err?.error?.response
              ?? err?.error?.message
              ?? '⚠️ Service IA indisponible. Vérifiez qu\'Ollama est lancé sur le port 11434.';
            return of({ response: msg });
          })
        );
      })
    );
  }

  ollamaAnalyse(context: {
    totalMesures: number;
    moyenne:      number;
    max:          number;
    alertes:      number;
    anomalies:    number;
    tendance:     string;
  }): Observable<{ response: string }> {
    const tendanceLabel = context.tendance === 'up'
      ? 'à la hausse ↑'
      : context.tendance === 'down'
        ? 'à la baisse ↓'
        : 'stable →';

    const prompt =
      `ANALYSE ÉNERGÉTIQUE WICMIC — Réponds UNIQUEMENT en français.
Données : ${context.totalMesures} mesures, moyenne ${context.moyenne} kWh, max ${context.max} kWh, ` +
      `${context.alertes} alertes, ${context.anomalies} anomalies, tendance ${tendanceLabel}.
Fournis : 1. Analyse situation (2 phrases) 2. Risques (1-2 phrases) 3. Deux recommandations chiffrées`;

    return this.ollamaChat(prompt);
  }

  // ════════════════════════════════════════════
  // EMAIL — Rapport IA
  // ════════════════════════════════════════════

  envoyerRapportIA(data: {
    destinataireEmail:   string;
    destinataireNom:     string;
    sujet:               string;   // ← FIX: champ ajouté
    resumeExecutif:      string;
    anomaliesHtml:       string;
    recommandationsHtml: string;
    previsionHtml:       string;
  }): Observable<any> {
    return this.http.post(
      `${this.BASE}/Email/rapport-ia`,   
      {
        DestinataireEmail:   data.destinataireEmail,
        DestinataireNom:     data.destinataireNom,
        Sujet:               data.sujet,             
        ResumeExecutif:      data.resumeExecutif,
        AnomaliesHtml:       data.anomaliesHtml,
        RecommandationsHtml: data.recommandationsHtml,
        PrevisionHtml:       data.previsionHtml,
      },
      { headers: this.getHeaders() }
    );
  }
}