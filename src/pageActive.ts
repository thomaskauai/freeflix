import { createContext, useContext } from 'react';

/**
 * Falso enquanto a página está guardada por baixo de outra (detalhes ou player
 * por cima da Home): ela segue montada, escondida, e não reage ao controle.
 */
export const PageActiveContext = createContext(true);

export const usePageActive = () => useContext(PageActiveContext);
