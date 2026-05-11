// ================================================
//  WICMIC — app-routing.module.ts
//  /register protégé : administrateur uniquement
// ================================================
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent }                from './pages/login/login.component';
import { AdminComponent }                from './pages/admin/admin.component';
import { RegisterComponent }             from './pages/register/register.component';
import { EnergyDashboardComponent }      from './pages/energy/energy-dashboard.component';
import { AuthGuard }                     from './core/auth/auth.guard';
import { RoleGuard }                     from './core/auth/role.guard';
import { ForgotPasswordComponent }       from './features/forgot-password/forgot-password.component';
import { ViewerComponent }               from './pages/viewer/viewer.component';
import { WaterDashboardComponent }       from './pages/energy/water/water-dashboard/water-dashboard.component';
import { GasDashboardComponent }         from './pages/energy/gas/gas-dashboard/gas-dashboard.component';
import { ElectricityDashboardComponent } from './pages/energy/electricity/electricity-dashboard/electricity-dashboard.component';

const ALL_ENERGY_ROLES = [
  'administrateur',
  'responsable_energie',
  'responsable_eau',
  'responsable_gaz',
  'responsable_electricite',
];

const routes: Routes = [
  { path: '',                redirectTo: 'login', pathMatch: 'full' },
  { path: 'login',           component: LoginComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },

  // ✅ CHANGEMENT 1 : /register protégé — admin seulement
  {
    path: 'register',
    component: RegisterComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ['administrateur'] },
  },

  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ['administrateur'] },
  },

  {
    path: 'energy/dashboard',
    component: EnergyDashboardComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ALL_ENERGY_ROLES },
  },

  {
    path: 'energy/water',
    component: WaterDashboardComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ALL_ENERGY_ROLES },
  },
  {
    path: 'energy/gas',
    component: GasDashboardComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ALL_ENERGY_ROLES },
  },
  {
    path: 'energy/electricity',
    component: ElectricityDashboardComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ALL_ENERGY_ROLES },
  },

  {
    path: 'viewer',
    component: ViewerComponent,
    canActivate: [AuthGuard, RoleGuard],
    data: { roles: ['employe', 'administrateur'] },
  },

  { path: '**', redirectTo: 'login' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}