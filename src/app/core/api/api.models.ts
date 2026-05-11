// ================================================
//  WICMIC — API Models (FIXED)
// ================================================

// ── Auth ──────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  nom: string;
  email: string;
  password: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  utilisateur: Utilisateur;
}

// ── Utilisateur ───────────────────────────────
export interface Utilisateur {
  idUtilisateur: number;
  nom: string;
  email: string;
  role: string;
  telephone?: string;
  dateCreation?: string;
}

// ── Site ──────────────────────────────────────
export interface Site {
  id: number;
  name: string;
  address?: string;
}

// ── Zone ──────────────────────────────────────
export interface Zone {
  idZone: number;
  nom: string;
  description?: string;
  dateCreation?: string;
  siteId: number;
  site?: Site | null;
}

// ── Equipement ────────────────────────────────
export interface Equipement {
  idEquipement: number;
  nom: string;
  typeEquipement: string;
  statut?: string;
  puissance?: number;
  localisation?: string;
  description?: string;
  dateInstallation?: string;
  dateMiseEnService?: string;
  energieId?: number;
  zoneId?: number;
  zone?: Zone;
  energie?: Energie;
}

// ── Energie ───────────────────────────────────
export interface Energie {
  idEnergie: number;
  nom: string;
  unite: string;
  dateCreation?: string;
  mesures?: any[];
}

// ── Mesure ────────────────────────────────────
export interface Mesure {
  idMesure:     number;
  valeur:       number;
  dateMesure:   string;
  dateCreation: string;
  sourceDonnee: string;
  energieId:    number;
  energie?:     Energie    | null;
  equipementId?: number    | null;
  equipement?:  Equipement | null;
  commentaire?: string;
}

// ── DTO création Mesure ───────────────────────
export interface CreateMesureDto {
  valeur: number;
  dateMesure: string;
  sourceDonnee: string;
  energieId: number;
  equipementId?: number | null;
}

// ── Alerte ────────────────────────────────────
export interface Alerte {
  idAlerte: number;
  type: string;
  seuil: number;
  message: string;
  dateCreation: string;
  traite: boolean;
  severite: 'Critique' | 'Haute' | 'Normale';
  equipementId?: number;
  equipement?: Equipement;
}

// ── Anomalie ──────────────────────────────────
export interface Anomalie {
  id: number;
  idAnomalie?: number;
  description: string;
  dateDetection: string;
  resolu: boolean;
  valeur?: number;
  severite?: string;
  energieId?: number | null;   // ← AJOUT : utilisé dans le dashboard
}

// ── Recommandation ────────────────────────────
export interface Recommandation {
  id: number;
  texte: string;
  date: string;
  priorite: 'Haute' | 'Moyenne' | 'Basse' | 'Faible';
  applique: boolean;
}

// ── Rapport ───────────────────────────────────
export interface Rapport {
  id?: number;
  titre: string;
  contenu: string;
  dateGeneration: string;
}

// ── Analyse Énergétique ───────────────────────
export interface AnalyseEnergetique {
  id?: number;
  description: string;
  resultat: string;
  dateAnalyse: string;
}

// ── Notification ──────────────────────────────
export interface Notification {
  id?: number;
  message: string;
  lu: boolean;
  dateCreation: string;
}

// ── Ollama (AI Chat) ─────────────────────────
export interface OllamaMessage {
  role: 'user' | 'assistant';
  content: string;
  time?: Date;
}

export interface OllamaResponse {
  response: string;
}