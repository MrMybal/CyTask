const target=new URL(document.currentScript.dataset.target,location.href);target.search=location.search;target.hash=location.hash;location.replace(target.href);
