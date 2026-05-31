import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, timer, throwError } from 'rxjs';
import { switchMap, map, catchError, takeWhile, last } from 'rxjs/operators';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface MoisData          { mois: string; total: number; }
export interface EnergieHistorique { nom: string; unite: string; mois: MoisData[]; }
export interface PrevisionRequest  { energies: EnergieHistorique[]; }

export interface RecoIA {
  titre:       string;
  description: string;
  economie:    number;
  urgence:     'haute' | 'normale';
}

export interface PrevisionIA {
  elec:          number;
  eau:           number;
  gazoil:        number;
  fiabilite:     number;
  elecTrend:     'up' | 'down' | 'flat';
  elecVar:       string;
  raisonnement:  string;
  hasEnoughData: boolean;
  recos:         RecoIA[];
}

export interface EnergieBenchmark {
  nom:           string;
  unite:         string;
  moisActuel:    number;
  moisPrecedent: number;
  moyenne:       number;
}

export interface BenchmarkRequest { energies: EnergieBenchmark[]; }

export interface BenchmarkItemIA {
  energie:       string;
  unite:         string;
  moisActuel:    number;
  moisPrecedent: number;
  moyenne:       number;
  variation:     number;
  position:      'better' | 'same' | 'worse';
  insight:       string;
  hasData:       boolean;
}

export interface BenchmarkIA {
  benchmarks:   BenchmarkItemIA[];
  resumeGlobal: string;
}

interface JobResponse {
  job_id: string;
  status: string;
}

interface JobResult<T> {
  status: string;
  result: T | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AiService {

  private readonly API          = 'http://localhost:8000';
  
  private readonly POLL_INTERVAL = 5000;   // 5 secondes
  private readonly MAX_POLLS     = 200;    // max ~16 minutes    // max 100 polls = 5 minutes

  constructor(private http: HttpClient) {}

  // ── Polling générique ──────────────────────────────────────────────────────

  private pollJob<T>(jobId: string, endpoint: string): Observable<T> {
    let pollCount = 0;

    return timer(0, this.POLL_INTERVAL).pipe(
      switchMap(() => {
        pollCount++;
        return this.http.get<JobResult<T>>(`${this.API}/${endpoint}/result/${jobId}`);
      }),
      takeWhile(res => {
        if (res.status === 'done' || res.status === 'error') return false;
        if (pollCount >= this.MAX_POLLS) return false;
        return true;
      }, true), 
      last(),    
      map(res => {
       if (res.status === 'error')   throw new Error('Job échoué côté serveur.');
      if (res.status === 'pending') throw new Error('Timeout — Ollama trop lent. Réessayez.');
      if (!res.result)              throw new Error('Résultat vide.');
      return res.result as T;
      }),
      catchError(err => {
        console.error(`[AiService] Polling ${endpoint} error:`, err);
        return throwError(() => err);
      })
    );
  }

  // ── Prévisions ─────────────────────────────────────────────────────────────

  getPrevisions(payload: PrevisionRequest): Observable<PrevisionIA> {
    return this.http.post<JobResponse>(`${this.API}/previsions/start`, payload).pipe(
      switchMap(res => this.pollJob<PrevisionIA>(res.job_id, 'previsions')),
      catchError(err => {
        console.error('[AiService] Prévisions error:', err);
        return of(this.fallbackPrevision());
      })
    );
  }

  // ── Benchmark ──────────────────────────────────────────────────────────────

  getBenchmark(payload: BenchmarkRequest): Observable<BenchmarkIA> {
    return this.http.post<JobResponse>(`${this.API}/benchmark/start`, payload).pipe(
      switchMap(res => this.pollJob<BenchmarkIA>(res.job_id, 'benchmark')),
      catchError(err => {
        console.error('[AiService] Benchmark error:', err);
        return of(this.fallbackBenchmark());
      })
    );
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  checkHealth(): Observable<any> {
    return this.http.get(`${this.API}/health`).pipe(
      catchError(() => of({ status: 'offline' }))
    );
  }

  // ── Fallbacks ──────────────────────────────────────────────────────────────

  private fallbackPrevision(): PrevisionIA {
    return {
      elec: 0, eau: 0, gazoil: 0,
      fiabilite:     0,
      elecTrend:     'flat',
      elecVar:       '0',
      raisonnement:  'Service IA indisponible. Vérifiez que FastAPI tourne sur le port 8000.',
      hasEnoughData: false,
      recos:         [],
    };
  }
  envoyerRapportIA(email: string, nom: string): Observable<any> {
  return this.http.post<JobResponse>(
    `${this.API}/rapport/email/start`,
    { email, nom }
  ).pipe(
    switchMap(res => this.pollJob<any>(res.job_id, 'rapport/email')),
    catchError(err => {
      console.error('[AiService] Email rapport error:', err);
      return throwError(() => err);
    })
  );
}
  private fallbackBenchmark(): BenchmarkIA {
    return {
      benchmarks:   [],
      resumeGlobal: 'Service IA indisponible. Vérifiez que FastAPI tourne sur le port 8000.',
    };
  }
}