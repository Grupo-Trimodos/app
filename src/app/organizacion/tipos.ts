type Grupo = { id: number | null; nombre: string; personas: number };
type Catalogo = { id: number; name: string; company_id: [number, string] | false };
export type Estructura = {
  plantilla: number; sin_responsable: number; consultado: string; aviso: string | null;
  grupos: Record<string, Grupo[]>; ubicaciones: Catalogo[]; departamentos: Catalogo[]; puestos: Catalogo[];
  relaciones: { id: number; nombre: string; estado: string; modelo: string;
    candidatos: { id: number; nombre: string; empresa: string }[] }[];
};
