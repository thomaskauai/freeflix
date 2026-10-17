/**
 * Indicador de carregamento no centro do contêiner. Só aparece se a espera
 * passar de um instante, para não piscar quando a resposta é rápida.
 */
export function Loading({ label = 'Carregando' }: { label?: string }) {
  return <div className="loading" aria-label={label} />;
}
