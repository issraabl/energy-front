import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Gestion des permissions par vecteur énergétique.
 *
 * Règle métier :
 *  - canWrite(x) → uniquement le responsable de x (et l'administrateur/resp. énergie)
 *  - canRead(x)  → TOUS les responsables énergie + administrateur
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {

  constructor(private auth: AuthService) {}

  private get role(): string {
    return this.auth.getCurrentUser()?.role ?? '';
  }

  // ── Écriture ────────────────────────────────────────────────────────────
  // Seul le responsable du vecteur concerné (+ admin + resp. énergie global)
  // peut créer / modifier des mesures.

  canWrite(energie: 'eau' | 'gaz' | 'electricite' | 'gazoil'): boolean {
    const r = this.role;
    if (r === 'administrateur' || r === 'responsable_energie') return true;

    switch (energie) {
      case 'eau':          return r === 'responsable_eau';
      case 'gaz':
      case 'gazoil':       return r === 'responsable_gaz';
      case 'electricite':  return r === 'responsable_electricite';
      default:             return false;
    }
  }

  // ── Lecture ─────────────────────────────────────────────────────────────
  // Tout responsable (quelle que soit son énergie) peut consulter
  // les données des autres vecteurs en lecture seule.

  canRead(energie: 'eau' | 'gaz' | 'electricite' | 'gazoil'): boolean {
    const r = this.role;
    // Administrateur et responsable général : accès total
    if (r === 'administrateur' || r === 'responsable_energie') return true;
    // Tous les responsables spécifiques peuvent lire tous les vecteurs
    if (
      r === 'responsable_eau'          ||
      r === 'responsable_gaz'          ||
      r === 'responsable_electricite'
    ) return true;

    return false;
  }

  // ── Helpers pratiques ───────────────────────────────────────────────────

  /** Retourne true si l'utilisateur est au moins un responsable (lecture seule mini). */
  get isAnyManager(): boolean {
    return [
      'administrateur',
      'responsable_energie',
      'responsable_eau',
      'responsable_gaz',
      'responsable_electricite',
    ].includes(this.role);
  }

  /** Libellé lisible du rôle courant. */
  get roleLabel(): string {
    const labels: Record<string, string> = {
      administrateur:           'Administrateur',
      responsable_energie:      'Resp. Énergie',
      responsable_eau:          'Resp. Eau',
      responsable_gaz:          'Resp. Gaz',
      responsable_electricite:  'Resp. Électricité',
      employe:                  'Employé',
    };
    return labels[this.role] ?? 'Utilisateur';
  }
}