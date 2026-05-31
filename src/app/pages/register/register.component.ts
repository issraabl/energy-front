// ================================================
//  WICMIC — Register Component
//  Accessible uniquement par l'administrateur
// ================================================
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

export type AppRole =
  | 'administrateur'
  | 'responsable_eau'
  | 'responsable_gaz'
  | 'responsable_electricite';

@Component({
  selector:    'wic-register',
  standalone:  true,
  imports:     [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls:   ['./register.component.css'],
})
export class RegisterComponent implements OnInit {

  /* ── State ─────────────────────────────────────── */
  showPassword  = signal(false);
  showConfirm   = signal(false);
  isLoading     = signal(false);
  errorMsg      = signal<string | null>(null);
  successMsg    = signal<string | null>(null);
  roleError     = signal(false);
  step          = signal<1 | 2>(1);
  selectedRole  = signal<AppRole | null>(null);

  /* ── Admin info ─────────────────────────────────── */
  adminName = signal<string>('');

  /* ── Form ─────────────────────────────────────── */
  form!: FormGroup;

  /* ── Roles (4) ──────────────────────────────────── */
  readonly roles: {
    id:          AppRole;
    label:       string;
    description: string;
    permissions: string[];
    colorKey:    string;
  }[] = [
    {
      id:          'administrateur',
      label:       'Administrateur',
      description: 'Gestion globale du système et des utilisateurs',
      colorKey:    'red',
      permissions: [
        'Gestion des comptes et des rôles',
        'Structure organisationnelle complète',
        'Supervision de toute la plateforme',
        'Accès à tous les modules',
      ],
    },
    {
      id:          'responsable_eau',
      label:       'Responsable eau',
      description: 'Pilotage de la consommation eau sur tous les sites',
      colorKey:    'blue',
      permissions: [
        'Suivi des compteurs eau',
        'Alertes de fuite et dépassement',
        'Rapports de consommation eau',
        'Gestion des équipements hydrauliques',
      ],
    },
    {
      id:          'responsable_gaz',
      label:       'Responsable gaz',
      description: 'Surveillance et optimisation des flux gaz',
      colorKey:    'orange',
      permissions: [
        'Suivi des compteurs gaz',
        'Détection des anomalies de pression',
        'Rapports de consommation gaz',
        'Gestion des équipements gaz',
      ],
    },
    {
      id:          'responsable_electricite',
      label:       'Responsable électricité',
      description: 'Contrôle des consommations électriques',
      colorKey:    'yellow',
      permissions: [
        'Suivi des compteurs électriques',
        'Analyse de la puissance appelée',
        'Rapports de consommation électrique',
        'Gestion des équipements électriques',
      ],
    },
  ];

  constructor(
    private fb:     FormBuilder,
    private auth:   AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const user = this.auth.getCurrentUser();
    this.adminName.set(user?.nom ?? 'Administrateur');

    this.form = this.fb.group(
      {
        fullName: ['', [Validators.required, Validators.minLength(3)]],
        company:  ['', [Validators.required]],
        email:    ['', [Validators.required, Validators.email]],
        password: ['', [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
        ]],
        confirm:  ['', Validators.required],
      },
      { validators: this.passwordMatchValidator }
    );
  }

  /* ── Custom validator ────────────────────────── */
  private passwordMatchValidator(group: AbstractControl) {
    const pw  = group.get('password')?.value;
    const cfm = group.get('confirm')?.value;
    return pw === cfm ? null : { mismatch: true };
  }

  /* ── Getters ────────────────────────────────────── */
  get confirmMismatch(): boolean {
    const ctrl = this.form?.get('confirm');
    return !!ctrl?.touched && !!this.form?.errors?.['mismatch'];
  }

  /* ── UI ─────────────────────────────────────────── */
  togglePassword(): void { this.showPassword.update(v => !v); }
  toggleConfirm():  void { this.showConfirm.update(v => !v);  }

  selectRole(id: AppRole): void {
    this.selectedRole.set(id);
    this.roleError.set(false);
    this.errorMsg.set(null);
  }

  isRoleSelected(id: AppRole): boolean {
    return this.selectedRole() === id;
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  /* ── Navigation ──────────────────────────────────── */
  nextStep(): void {
    const step1Controls = ['fullName', 'company', 'email', 'password', 'confirm'];
    step1Controls.forEach(k => this.form.get(k)?.markAsTouched());
    const fieldsValid = step1Controls.every(k => this.form.get(k)?.valid);
    const noMismatch  = !this.form.errors?.['mismatch'];
    if (fieldsValid && noMismatch) this.step.set(2);
  }

  prevStep(): void { this.step.set(1); }

  /* ── Submit ──────────────────────────────────────── */
  onSubmit(): void {
    if (!this.selectedRole()) {
      this.roleError.set(true);
      this.errorMsg.set('Veuillez sélectionner un rôle pour continuer.');
      return;
    }

    this.isLoading.set(true);
    this.errorMsg.set(null);
    this.successMsg.set(null);

    this.auth.register({
      nom:      this.form.value.fullName,
      email:    this.form.value.email,
      password: this.form.value.password,
      role:     this.selectedRole()!,
    }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.successMsg.set(
          `Le compte de ${this.form.value.fullName} (${this.selectedRole()}) a été créé avec succès.`
        );
        this.form.reset();
        this.selectedRole.set(null);
        this.step.set(1);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMsg.set(
          err.status === 400
            ? (err.error ?? 'Cet email est déjà utilisé.')
            : 'Erreur serveur. Veuillez réessayer.'
        );
      },
    });
  }

  /* ── Retour dashboard ─────────────────────────────── */
  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  /* ── Helpers ─────────────────────────────────────── */
  isInvalid(fieldName: string): boolean {
    const ctrl = this.form?.get(fieldName);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  fieldError(fieldName: string): string {
    const ctrl = this.form?.get(fieldName);
    if (!ctrl?.errors || !ctrl.touched) return '';
    if (ctrl.errors['required'])  return 'Ce champ est requis.';
    if (ctrl.errors['email'])     return 'Adresse e-mail invalide.';
    if (ctrl.errors['minlength']) return `Minimum ${ctrl.errors['minlength'].requiredLength} caractères.`;
    if (ctrl.errors['pattern'])   return 'Doit contenir une majuscule, un chiffre et un caractère spécial (@$!%*?&).';
    return 'Valeur invalide.';
  }
}