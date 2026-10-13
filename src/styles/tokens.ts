// Espelho dos poucos tokens de tokens.css que o JS precisa conhecer.
export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** janela mais larga que isso (em px de palco) amplia tudo, em vez de alargar o palco */
export const STAGE_MAX_W = 2560;
/** escala mínima: abaixo dela o palco encolhe para o texto continuar legível */
export const MIN_SCALE = 0.6;
/** palco mais estreito que isso usa o layout compacto (celular em pé) */
export const COMPACT_W = 1000;
/** palco mais baixo que isso aperta o respiro vertical (celular deitado) */
export const SHORT_H = 700;
/** altura da barra de navegação do layout compacto; espelha --tabbar-h */
export const TABBAR_H = 104;
/** quanto da tela sobra abaixo do destaque, para a primeira fileira aparecer */
export const HERO_PEEK = 248;
/** y em que o título da fileira focada estaciona */
export const ROW_ANCHOR = 72;
/** folga à direita ao chegar no fim de uma fileira */
export const ROW_END_GAP = 60;
/** folga do recorte da fileira, para o contorno de foco não ser cortado */
export const ROW_CLIP_PAD = 8;
/** y em que a linha focada de uma grade estaciona: onde nasce a primeira linha */
export const SEARCH_GRID_ANCHOR = 122;
export const LIST_GRID_ANCHOR = 162;
