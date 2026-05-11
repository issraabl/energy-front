// ================================================
//  WICMIC — Admin Guard
//  Protège /register : seul l'administrateur peut y accéder
// ================================================
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {

  constructor(private auth: AuthService, private router: Router) {}

  canActivate(): boolean {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return false;
    }

    const role = this.auth.getRole();
    if (role === 'administrateur') {
      return true;
    }

    // Connecté mais pas admin → rediriger vers dashboard
    this.router.navigate(['/dashboard']);
    return false;
  }
}