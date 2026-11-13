// Solo para la vista previa en el navegador durante el desarrollo (la app de campo es Android/iOS).
// El navegador no tiene almacenamiento seguro: se usa localStorage.
export const getItemAsync = async (k: string) => localStorage.getItem(k);
export const setItemAsync = async (k: string, v: string) => localStorage.setItem(k, v);
export const deleteItemAsync = async (k: string) => localStorage.removeItem(k);
