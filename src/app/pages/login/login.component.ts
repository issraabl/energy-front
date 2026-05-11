import { Component, OnInit, OnDestroy, signal } from '@angular/core';
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

@Component({
  selector:    'wic-login',
  standalone:  true,
  imports:     [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls:   ['./login.component.css'],
})
export class LoginComponent implements OnInit, OnDestroy {

  // ── Signaux login principal ───────────────────────────────
  showPassword  = signal(false);
  isLoading     = signal(false);
  errorMsg      = signal<string | null>(null);

  // ── Signaux modal admin ───────────────────────────────────
  showAdminModal      = signal(false);
  showAdminPassword   = signal(false);
  adminCheckLoading   = signal(false);
  adminErrorMsg       = signal<string | null>(null);

  // ── Formulaires ───────────────────────────────────────────
  form!:       FormGroup;
  adminForm!:  FormGroup;

  private carouselInterval: ReturnType<typeof setInterval> | null = null;
  private currentTestiIndex = 0;
  private readonly TESTI_COUNT = 3;

  constructor(
    private fb:     FormBuilder,
    private auth:   AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) {
      this.redirectByRole(this.auth.getRole());
      return;
    }

    // Formulaire login principal
    this.form = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(1)]],
      remember: [false],
    });

    // Formulaire vérification admin (dans le modal)
    this.adminForm = this.fb.group({
      email:    ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(1)]],
    });

    this.startCarousel();
    setTimeout(() => this.bindDots(), 0);
  }

  ngOnDestroy(): void {
    this.stopCarousel();
  }

  // ── Carousel ──────────────────────────────────────────────

  private startCarousel(): void {
    this.carouselInterval = setInterval(() => {
      this.showTesti((this.currentTestiIndex + 1) % this.TESTI_COUNT);
    }, 4500);
  }

  private stopCarousel(): void {
    if (this.carouselInterval) {
      clearInterval(this.carouselInterval);
      this.carouselInterval = null;
    }
  }

  private bindDots(): void {
    const dots = document.querySelectorAll<HTMLButtonElement>('.testi-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const idx = Number(dot.dataset['index']);
        this.stopCarousel();
        this.showTesti(idx);
        this.startCarousel();
      });
    });
  }

  private showTesti(index: number): void {
    for (let i = 0; i < this.TESTI_COUNT; i++) {
      document.getElementById(`testi-${i}`)?.classList.remove('active');
      document.querySelector<HTMLButtonElement>(`.testi-dot[data-index="${i}"]`)
        ?.classList.remove('active');
    }
    document.getElementById(`testi-${index}`)?.classList.add('active');
    document.querySelector<HTMLButtonElement>(`.testi-dot[data-index="${index}"]`)
      ?.classList.add('active');
    this.currentTestiIndex = index;
  }

  // ── Redirection par rôle ──────────────────────────────────

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

  // ── Login principal ───────────────────────────────────────

  get email()    { return this.form.get('email');    }
  get password() { return this.form.get('password'); }

  togglePassword(): void { this.showPassword.update(v => !v); }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.auth.login({
      email:    this.form.value.email,
      password: this.form.value.password,
    }).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.redirectByRole(res.role?.toLowerCase().trim() ?? null);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err.status === 401) {
          this.errorMsg.set('Email ou mot de passe incorrect.');
        } else {
          this.errorMsg.set('Erreur serveur. Veuillez réessayer.');
        }
      },
    });
  }

  isInvalid(ctrl: AbstractControl | null): boolean {
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  fieldError(ctrl: AbstractControl | null): string {
    if (!ctrl?.errors || !ctrl.touched) return '';
    if (ctrl.errors['required'])  return 'Ce champ est requis.';
    if (ctrl.errors['email'])     return 'Adresse e-mail invalide.';
    if (ctrl.errors['minlength']) return `Minimum ${ctrl.errors['minlength'].requiredLength} caractères.`;
    return 'Valeur invalide.';
  }

  // ── Modal vérification admin ──────────────────────────────

  // Ouvre le modal quand on clique "Créer un compte"
  openAdminModal(): void {
    this.adminForm.reset();
    this.adminErrorMsg.set(null);
    this.showAdminModal.set(true);
  }

  // Ferme le modal
  closeAdminModal(): void {
    this.showAdminModal.set(false);
    this.adminErrorMsg.set(null);
    this.adminForm.reset();
  }

  // Bascule visibilité mot de passe dans le modal
  toggleAdminPassword(): void {
    this.showAdminPassword.update(v => !v);
  }

  // Getters pour les champs du formulaire admin
  get adminEmail()    { return this.adminForm.get('email');    }
  get adminPassword() { return this.adminForm.get('password'); }

  // Soumission du formulaire admin dans le modal
  onAdminSubmit(): void {
    if (this.adminForm.invalid) {
      this.adminForm.markAllAsTouched();
      return;
    }

    this.adminCheckLoading.set(true);
    this.adminErrorMsg.set(null);

    this.auth.login({
      email:    this.adminForm.value.email,
      password: this.adminForm.value.password,
    }).subscribe({
      next: (res) => {
        this.adminCheckLoading.set(false);
        const role = res.role?.toLowerCase().trim();

        if (role === 'administrateur') {
          // ✅ Admin confirmé → fermer modal et aller sur /register
          this.showAdminModal.set(false);
          this.router.navigate(['/register']);
        } else {
          // ❌ Connecté mais pas admin
          this.adminErrorMsg.set('Ce compte n\'a pas les droits administrateur.');
          // On déconnecte pour ne pas garder une session non-admin
          this.auth.logout();
        }
      },
      error: (err) => {
        this.adminCheckLoading.set(false);
        if (err.status === 401) {
          this.adminErrorMsg.set('Email ou mot de passe incorrect.');
        } else {
          this.adminErrorMsg.set('Erreur serveur. Veuillez réessayer.');
        }
      },
    });
  }
}