export type DatabaseKind="postgres"|"mysql"|"sqlite"|"mongodb";
export interface DatabaseAdapter{readonly kind:DatabaseKind;getSchemaSummary():Promise<string>;}
