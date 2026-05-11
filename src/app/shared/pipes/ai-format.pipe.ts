// ai-format.pipe.ts
// Créez ce fichier dans votre dossier shared/pipes/
// Puis importez-le dans energy-dashboard.component.ts via le tableau imports
 
import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
 
@Pipe({
  name: 'aiFormat',
  standalone: true
})
export class AiFormatPipe implements PipeTransform {
 
  constructor(private sanitizer: DomSanitizer) {}
 
  transform(value: string): SafeHtml {
    if (!value) return '';
 
    let html = value
      // Gras **texte**
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italique *texte*
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code inline `code`
      .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 5px;border-radius:4px;font-family:DM Mono,monospace;font-size:12px;color:#334155">$1</code>')
      // Titres ### ## #
      .replace(/^### (.+)$/gm, '<strong style="display:block;color:#0f172a;margin-top:8px">$1</strong>')
      .replace(/^## (.+)$/gm,  '<strong style="display:block;color:#0f172a;margin-top:10px;font-size:14px">$1</strong>')
      .replace(/^# (.+)$/gm,   '<strong style="display:block;color:#0f172a;margin-top:10px;font-size:15px">$1</strong>')
      // Listes - item
      .replace(/^- (.+)$/gm,   '<span style="display:block;padding-left:12px;margin:2px 0">• $1</span>')
      // Sauts de ligne
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
 
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
 
// ══════════════════════════════════════════════════════
// AJOUT DANS energy-dashboard.component.ts :
//
 
//
// @Component({
//   ...
//   imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule, AiFormatPipe],
// })
// ══════════════════════════════════════════════════════
 