
// Static fallback catalog — used when the backend API is unreachable.
// Manage products without touching code: use the Admin → Shop Manager panel.
var prodb = [
	{
		id: "gc01",
		pname: "Genetically Cursed! Mug",
		price: 18.99,
		rating: 4.8,
		collection: "bp",
		description: "Own your genetic misfortune in style. Bold, bubbly, and brutally honest.",
		image: "./Assets/productpreviews/gencursedleft.png",
		imageLeft:   "./Assets/productpreviews/gencursedleft.png",
		imageCenter: "",
		imageRight:  "",
		printifyIdLeft:   "6a0d441cf34bf3e7a90b8942",
		variantIdLeft:    "65216",
		printifyIdCenter: "",
		variantIdCenter:  "",
		printifyIdRight:  "",
		variantIdRight:   "",
		printifyProductId: "6a0d441cf34bf3e7a90b8942",
		variantId: "65216"
	},
	{
		id: "hy01",
		pname: "Hypergamy Mug",
		price: 18.99,
		rating: 4.5,
		collection: "bp",
		description: "Bold and unapologetic, just like your morning opinions.",
		image: "./Assets/finaldesigns/BPcollection/hypergamyfinal.png",
		imageLeft:   "./Assets/finaldesigns/BPcollection/hypergamyfinal.png",
		imageCenter: "",
		imageRight:  "",
		printifyIdLeft: "", variantIdLeft: "",
		printifyIdCenter: "", variantIdCenter: "",
		printifyIdRight: "", variantIdRight: "",
		printifyProductId: "", variantId: ""
	},
	{
		id: "bp01",
		pname: "BP Brutal Mug",
		price: 18.99,
		rating: 4.6,
		collection: "bp",
		description: "No filters, no apologies. Take your coffee as seriously as your takes.",
		image: "./Assets/finaldesigns/BPcollection/bpbrutal.png",
		imageLeft:   "./Assets/finaldesigns/BPcollection/bpbrutal.png",
		imageCenter: "", imageRight: "",
		printifyIdLeft: "", variantIdLeft: "",
		printifyIdCenter: "", variantIdCenter: "",
		printifyIdRight: "", variantIdRight: "",
		printifyProductId: "", variantId: ""
	},
	{
		id: "bi01",
		pname: "Big EP Mug",
		price: 21.99,
		rating: 4.7,
		collection: "fame",
		description: "Gothic monogram energy for the infamous. A statement piece.",
		image: "./Assets/finaldesigns/Fame&InfamyCollection/bigep.png",
		imageLeft:   "./Assets/finaldesigns/Fame&InfamyCollection/bigep.png",
		imageCenter: "", imageRight: "",
		printifyIdLeft: "", variantIdLeft: "",
		printifyIdCenter: "", variantIdCenter: "",
		printifyIdRight: "", variantIdRight: "",
		printifyProductId: "", variantId: ""
	},
	{
		id: "sg01",
		pname: "Made Via Spontaneous Generation Mug",
		price: 19.99,
		rating: 4.9,
		collection: "stem",
		description: "For the biology nerd who questions everything. Redi would be horrified.",
		image: "./Assets/finaldesigns/StemCollection/spontaneousgeneration.png",
		imageLeft:   "./Assets/finaldesigns/StemCollection/spontaneousgeneration.png",
		imageCenter: "", imageRight: "",
		printifyIdLeft: "", variantIdLeft: "",
		printifyIdCenter: "", variantIdCenter: "",
		printifyIdRight: "", variantIdRight: "",
		printifyProductId: "", variantId: ""
	}
];

// Promise that resolves once the catalog is ready.
// Pages should call: prodbReady.then(function() { /* render */ });
var prodbReady = (function () {
  function resolveApiBase() {
    if (window.__DORKMUGS_API_BASE__) return String(window.__DORKMUGS_API_BASE__).replace(/\/+$/, '');
    if (window.location.protocol === 'file:') return 'http://localhost:5000/api';
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return window.location.protocol + '//' + window.location.hostname + ':5000/api';
    }
    return window.location.origin.replace(/\/+$/, '') + '/api';
  }

  return fetch(resolveApiBase() + '/shop-products')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.products && data.products.length) {
        // Normalise API rows to the same shape as the static fallback
        prodb = data.products.map(function (p) {
          var img = p.imageLeft || p.imageCenter || p.imageRight || '';
          return {
            id: p.id, pname: p.pname, price: p.price, rating: p.rating,
            collection: p.collection, description: p.description,
            image: img,
            imageLeft:   p.imageLeft   || '', imageCenter: p.imageCenter || '', imageRight: p.imageRight || '',
            printifyIdLeft:   p.printifyIdLeft   || '', variantIdLeft:   p.variantIdLeft   || '',
            printifyIdCenter: p.printifyIdCenter || '', variantIdCenter: p.variantIdCenter || '',
            printifyIdRight:  p.printifyIdRight  || '', variantIdRight:  p.variantIdRight  || '',
            // legacy single-placement compat
            printifyProductId: p.printifyIdLeft || '', variantId: p.variantIdLeft || '',
          };
        });
      }
    })
    .catch(function () { /* silently keep static fallback */ });
})();
