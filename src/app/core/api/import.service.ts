import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ImportService {
  private apiUrl = 'https://localhost:7128/api/import';

  constructor(private http: HttpClient) {}

  importerMesures(file: File): Observable<{ message: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ message: string }>(`${this.apiUrl}/mesures`, form);
  }
}