export interface LoginRequest {
  email:    string;
  password: string;
}

export interface RegisterRequest {
  nom:      string;
  email:    string;
  password: string;
  role?:    string;
}

export interface AuthResponse {
  idUtilisateur: number;
  token:         string;
  email:         string;
  nom:           string;
  role:          string;
}

export type UserRole =
  | 'administrateur'
  | 'responsable_energie'
  | 'responsable_eau'
  | 'responsable_gaz'
  | 'responsable_electricite'
  | 'employe';