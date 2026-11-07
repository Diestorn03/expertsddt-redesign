/* §6.2: classic, external and blocking, so the saved or system theme is set before the first paint. Only sets data-theme
   (the panel bundle adds html.js itself, so a failed bundle leaves the page in its no-JS mode). */
(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem('theme')}catch(e){}
if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t})();
