// ================================================
//  WICMIC — RoleGuard + Permissions
//  Ce fichier exporte :
//    • Role (type)
//    • Permission (interface)
//    • getPermissions()
//    • hasPermission()
//    • RoleGuard (class Angular)
// ================================================
import { Injectable }                                   from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService }                                   from './auth.service';

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'administrateur' | 'responsable_energie' | 'employe';

export interface Permission {
  canViewMesures:          boolean;
  canViewStatistiques:     boolean;
  canViewAlertes:          boolean;
  canTraiterAlertes:       boolean;
  canViewIA:               boolean;
  canUseIA:                boolean;
  canViewEquipements:      boolean;
  canEditEquipements:      boolean;
  canDeleteEquipements:    boolean;
  canViewAdministration:   boolean;
  canManageSites:          boolean;
  canManageZones:          boolean;
  canViewUtilisateurs:     boolean;
  canManageUtilisateurs:   boolean;
  canExport:               boolean;
}

// ── Matrice des permissions ───────────────────────────────────────────────────

const PERMISSIONS: Record<Role, Permission> = {
  administrateur: {
    canViewMesures:          true,
    canViewStatistiques:     true,
    canViewAlertes:          true,
    canTraiterAlertes:       true,
    canViewIA:               true,
    canUseIA:                true,
    canViewEquipements:      true,
    canEditEquipements:      true,
    canDeleteEquipements:    true,
    canViewAdministration:   true,
    canManageSites:          true,
    canManageZones:          true,
    canViewUtilisateurs:     true,
    canManageUtilisateurs:   true,
    canExport:               true,
  },
  responsable_energie: {
    canViewMesures:          true,
    canViewStatistiques:     true,
    canViewAlertes:          true,
    canTraiterAlertes:       true,
    canViewIA:               true,
    canUseIA:                true,
    canViewEquipements:      true,
    canEditEquipements:      true,
    canDeleteEquipements:    false,
    canViewAdministration:   true,
    canManageSites:          false,
    canManageZones:          false,
    canViewUtilisateurs:     false,
    canManageUtilisateurs:   false,
    canExport:               true,
  },
  employe: {
    canViewMesures:          true,
    canViewStatistiques:     false,
    canViewAlertes:          true,
    canTraiterAlertes:       false,
    canViewIA:               false,
    canUseIA:                false,
    canViewEquipements:      true,
    canEditEquipements:      false,
    canDeleteEquipements:    false,
    canViewAdministration:   false,
    canManageSites:          false,
    canManageZones:          false,
    canViewUtilisateurs:     false,
    canManageUtilisateurs:   false,
    canExport:               false,
  },
};

// ── Fonctions utilitaires ─────────────────────────────────────────────────────

export function getPermissions(role: Role): Permission {
  return PERMISSIONS[role] ?? PERMISSIONS['employe'];
}

export function hasPermission(role: Role, key: keyof Permission): boolean {
  return getPermissions(role)[key];
}

// ── Guard Angular ─────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {

  constructor(private auth: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    const allowedRoles: string[] = route.data?.['roles'] ?? [];
    const userRole = this.auth.getRole();

    if (userRole && allowedRoles.includes(userRole)) {
      return true;
    }

    this.redirectByRole(userRole);
    return false;
  }

  private redirectByRole(role: string | null): void {
    switch (role) {
      case 'administrateur':
        this.router.navigate(['/admin']);
        break;
      case 'responsable_energie':
      case 'responsable_eau':
      case 'responsable_gaz':
      case 'responsable_electricite':
        this.router.navigate(['/energy/dashboard']);
        break;
      case 'employe':
        this.router.navigate(['/viewer']);
        break;
      default:
        this.router.navigate(['/login']);
    }
  }
}