import React from 'react';

/** False while a page is kept hidden behind another, so it can hold still. */
export const PageShown = React.createContext(true);

export const usePageShown = () => React.useContext(PageShown);
