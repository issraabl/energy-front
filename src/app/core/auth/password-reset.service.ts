import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class PasswordResetService {

  private base = `${environment.apiUrl}/api/auth`;

  constructor(private http: HttpClient) {}

  sendCode(email: string): Observable<any> {
    return this.http.post(`${this.base}/forgot-password`, { email });
  }

  verifyCode(email: string, code: string): Observable<any> {
    return this.http.post(`${this.base}/verify-reset-code`, { email, code });
  }

  resetPassword(email: string, code: string, newPassword: string): Observable<any> {
    return this.http.post(`${this.base}/reset-password`, { email, code, newPassword });
  }
}