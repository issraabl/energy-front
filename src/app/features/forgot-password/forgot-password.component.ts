import { Component, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { PasswordResetService } from '../../core/auth/password-reset.service';

@Component({
  selector: 'wic-forgot-password',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css'],
})
export class ForgotPasswordComponent implements OnDestroy {

  step = signal<'email' | 'code' | 'password' | 'success'>('email');

  emailForm!:    FormGroup;
  codeForm!:     FormGroup;
  passwordForm!: FormGroup;

  loading             = signal(false);
  errorMsg            = signal('');
  userEmail           = signal('');
  showNewPassword     = signal(false);
  showConfirmPassword = signal(false);
  resendCooldown      = signal(0);

  private cooldownInterval: any;

  constructor(
    private fb:     FormBuilder,
    private svc:    PasswordResetService,
    private router: Router,
  ) {
    this.emailForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });

    this.codeForm = this.fb.group({
      d0: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d1: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d2: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d3: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d4: ['', [Validators.required, Validators.pattern(/^\d$/)]],
      d5: ['', [Validators.required, Validators.pattern(/^\d$/)]],
    });

    this.passwordForm = this.fb.group(
      {
        newPassword:     ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', Validators.required],
      },
      { validators: this.matchPasswords }
    );
  }

  ngOnDestroy(): void {
    clearInterval(this.cooldownInterval);
  }

  private matchPasswords(g: AbstractControl) {
    return g.get('newPassword')?.value === g.get('confirmPassword')?.value
      ? null : { mismatch: true };
  }

  // ── Étape 1 ──────────────────────────────────────────────────────────────
  submitEmail(): void {
    if (this.emailForm.invalid) { this.emailForm.markAllAsTouched(); return; }
    this.loading.set(true);
    this.errorMsg.set('');
    const email = this.emailForm.value.email;

    this.svc.sendCode(email).subscribe({
      next: () => {
        this.userEmail.set(email);
        this.loading.set(false);
        this.step.set('code');
        this.startCooldown();
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(
          err?.error?.message || 'Erreur lors de l\'envoi. Vérifiez votre adresse.'
        );
      },
    });
  }

  // ── Étape 2 ──────────────────────────────────────────────────────────────
  get fullCode(): string {
    const v = this.codeForm.value;
    return `${v.d0}${v.d1}${v.d2}${v.d3}${v.d4}${v.d5}`;
  }

  onDigitInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const val   = input.value.replace(/\D/g, '').slice(-1);
    this.codeForm.get(`d${index}`)?.setValue(val);
    if (val && index < 5) {
      (document.getElementById(`digit-${index + 1}`) as HTMLInputElement)?.focus();
    }
  }

  onDigitKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace' && !this.codeForm.get(`d${index}`)?.value && index > 0) {
      (document.getElementById(`digit-${index - 1}`) as HTMLInputElement)?.focus();
    }
  }

  onDigitPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) ?? '';
    pasted.split('').forEach((char, i) => this.codeForm.get(`d${i}`)?.setValue(char));
    const focusIdx = Math.min(pasted.length, 5);
    (document.getElementById(`digit-${focusIdx}`) as HTMLInputElement)?.focus();
  }

  submitCode(): void {
    if (this.codeForm.invalid) { this.codeForm.markAllAsTouched(); return; }
    this.loading.set(true);
    this.errorMsg.set('');

    this.svc.verifyCode(this.userEmail(), this.fullCode).subscribe({
      next:  () => { this.loading.set(false); this.step.set('password'); },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err?.error?.message || 'Code incorrect.');
      },
    });
  }

  resendCode(): void {
    if (this.resendCooldown() > 0) return;
    this.errorMsg.set('');

    this.svc.sendCode(this.userEmail()).subscribe({
      next:  () => { this.startCooldown(); },
      error: (err) => {
        this.errorMsg.set(err?.error?.message || 'Erreur lors du renvoi.');
      },
    });
  }

  private startCooldown(): void {
    this.resendCooldown.set(60);
    clearInterval(this.cooldownInterval);
    this.cooldownInterval = setInterval(() => {
      const v = this.resendCooldown() - 1;
      this.resendCooldown.set(v);
      if (v <= 0) clearInterval(this.cooldownInterval);
    }, 1000);
  }

  // ── Étape 3 ──────────────────────────────────────────────────────────────
  submitPassword(): void {
    if (this.passwordForm.invalid) { this.passwordForm.markAllAsTouched(); return; }
    this.loading.set(true);
    this.errorMsg.set('');

    this.svc.resetPassword(
      this.userEmail(),
      this.fullCode,
      this.passwordForm.value.newPassword
    ).subscribe({
      next:  () => { this.loading.set(false); this.step.set('success'); },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err?.error?.message || 'Erreur lors de la réinitialisation.');
      },
    });
  }

  goToLogin(): void { this.router.navigate(['/login']); }

  isInvalid(ctrl: AbstractControl | null): boolean {
    return !!(ctrl && ctrl.invalid && ctrl.touched);
  }
}