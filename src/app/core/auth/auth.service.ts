import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  nom: string;
  email: string;
  password: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  idUtilisateur?: number;
  email?: string;
  nom?: string;
  role?: string;
  utilisateur?: {
    idUtilisateur: number;
    email: string;
    nom: string;
    role: string;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {

  private readonly API       = 'https://localhost:7128/api/Auth';
  private readonly TOKEN_KEY = 'wicmic_token';
  private readonly USER_KEY  = 'wicmic_user';

  constructor(private http: HttpClient, private router: Router) {}

  login(payload: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API}/Login`, payload).pipe(
      tap(res => this.saveSession(res))
    );
  }

  register(payload: RegisterRequest): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.API}/Register`, payload);
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.router.navigate(['/login']);
  }

  private saveSession(res: AuthResponse): void {
    localStorage.setItem(this.TOKEN_KEY, res.token);

    const u = res.utilisateur ?? res;

    const user = {
      idUtilisateur: u.idUtilisateur ?? 0,
      email:         u.email         ?? '',
      nom:           u.nom           ?? '',
      role:          (u.role ?? '').toLowerCase().trim(),
    };

    console.log('[Auth] Utilisateur connecté:', user);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  getCurrentUser(): { idUtilisateur: number; email: string; nom: string; role: string } | null {
    const raw = localStorage.getItem(this.USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  getRole(): string | null {
    return this.getCurrentUser()?.role ?? null;
  }
}