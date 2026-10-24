// Set the motion mode before first paint (no flash). Saved choice wins; otherwise reduced-motion => off.
(function(){var m;try{m=localStorage.getItem('cp77.motion')}catch(e){}
if(m!=='full'&&m!=='calm'&&m!=='off'){m=(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)?'off':'full'}
document.documentElement.setAttribute('data-motion',m)})();
