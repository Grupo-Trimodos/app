export type Catalogo = {
  vehiculos: { id: number; matricula: string; modelo: string; empresa: string; conductor: string }[];
  choferes: { id: number; nombre: string; empresa: string }[];
  limitado: boolean; incluye_externos: boolean;
};

