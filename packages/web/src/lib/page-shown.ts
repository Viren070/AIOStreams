import React from 'react';

/** False while a page is kept hidden behind another, so it can hold still. */
export const PageShown = React.createContext(true);

export const usePageShown = () => React.useContext(PageShown);

/** The query of the history entry a page shows, which stays its own while it is kept. */
export const PageSearch = React.createContext('');

export const usePageSearch = () => React.useContext(PageSearch);
