import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImportService } from '../../core/api/import.service';

@Component({
  selector: 'app-import-mesures',
  standalone: false,
  templateUrl: './import-mesures.component.html',
  styleUrls: ['./import-mesures.component.css']
})
export class ImportMesuresComponent {
  fichierSelectionne: File | null = null;
  message = '';
  erreur = '';
  enCours = false;

  constructor(private importService: ImportService) {}

  onFichierChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.fichierSelectionne = input.files[0];
      this.message = '';
      this.erreur = '';
    }
  }

  importer() {
    if (!this.fichierSelectionne) {
      this.erreur = 'Veuillez sélectionner un fichier .xlsx';
      return;
    }
    this.enCours = true;
    this.message = '';
    this.erreur = '';

    this.importService.importerMesures(this.fichierSelectionne).subscribe({
      next: (res: { message: string }) => {
        this.message = res.message;
        this.enCours = false;
        this.fichierSelectionne = null;
      },
      error: (err: any) => {
        this.erreur = err.error?.message || 'Erreur lors de l\'import.';
        this.enCours = false;
      }
    });
  }
}