export type Catalogo = {
  vehiculos: { id: number; matricula: string; modelo: string; empresa: string; conductor: string }[];
  choferes: { id: number; nombre: string; empresa: string }[];
  limitado: boolean; incluye_externos: boolean;
};

export type VehiculoAviso = { id: number; matricula: string; modelo: string; empresa: string; tipo: string; chofer_baja?: string };
export type AvisosAsignacion = {
  camiones: number;
  camiones_sin_chofer: VehiculoAviso[];
  remolques_sin_chofer: VehiculoAviso[];
  choferes_sin_camion: { id: number; nombre: string; empresa: string }[];
  choferes_varios_camiones: { id: number; nombre: string; matriculas: string[] }[];
  conductores: number; conductores_sin_ficha: number;
};
