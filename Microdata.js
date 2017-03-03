{
	"translatorID": "fcb1b13c-afc8-453c-bd9c-399b06911e3a",
	"label": "Microdata",
	"creator": "Philipp Zumstein, Daniel Gerber",
	"target": null,
	"minVersion": "3.0",
	"maxVersion": null,
	"priority": 300,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2017-03-01 11:24:50"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2016-2017 Philipp Zumstein, Daniel Gerber

	This file is part of Zotero.

	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero. If not, see <http://www.gnu.org/licenses/>.

	***** END LICENSE BLOCK *****
*/

exports = { detectWeb, doWeb }


function detectWeb(doc, url) {
	// ~acceptably wrong, fast
	if (doc.querySelectorAll('[itemscope][itemtype*="://schema.org/"]').length){
		return 'multiple'
	}
}

function doWeb(doc, url) {
	askImportRDF(microCosmos(doc).triples())
}

function microCosmos(doc){
	// Zotero evaluates the "module" scope more than once, const won't work there
	const RDFS_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
		  HCARD = 'http://microformats.org/profile/hcard',
		  ADD_TYPE = 'http://schema.org/additionalType',
		  RDFS_TYPE_NODE = { interfaceName: 'NamedNode', nominalValue: RDFS_TYPE }

	const scopes = new Map
	let uid = 0

	const _uriResolver = doc.createElement('a')
	function resolveURI(string, base/*=doc.URL*/){
		// // URL is not available to Zotero translators
		// try { return (new URL(string, base)).href }
		// catch (e) { }
		if (base) return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(string) ? string : base + string
		_uriResolver.href = string
		return _uriResolver.href
	}

	return { triples }

	/**
	 * Roughly follows https://www.w3.org/TR/microdata-rdf/#generate-the-triples
	 */
	function* triples(depth=Infinity, sel=':not([itemprop])'){
		const visited = new Set
		for (const s of iterScopes(sel)){
			yield* s.triples(depth, visited)
		}
	}

	function* iterScopes(sel=''/*e.g. [itemtype^=..] or :not([itemprop]) (top-level scopes)*/){
		for (const n of doc.querySelectorAll(sel + '[itemscope]')){
			yield microScope(n)
		}
	}

	function microScope(node){
		if (!scopes.has(node)) scopes.set(node, makeMicroScope(node))
		return scopes.get(node)
	}

	function getValue(node){
		return node.hasAttribute('itemscope') ? microScope(node) : parseValue(node).trim()
	}

	function makeMicroScope(node){
		// Resolve RDF node ids and types w.r.t. document base URI
		const types = splitGet(node, 'itemtype').map(resolveURI),
			  type = types[0],
			  // Resolve prop names w.r.t. the first item type URI
			  // hcard is an exception
			  base = (/(.*?)[^#\/]*$/).exec((type && type.startsWith(HCARD)) ? type+'#' : type)[1],
			  id = node.getAttribute('itemid'),
			  interfaceName = id ? 'NamedNode' : 'BlankNode',
			  nominalValue = id ? resolveURI(id) : '_:md-blank-'+uid++,
			  subject = { interfaceName, nominalValue }

		return { subject, triples }

		function* triples(depth=Infinity, visited=new Set/*, defaultBase*/){
			if (visited.has(node)){
				Z.debug('Ignoring duplicate item node (invalid itemref?)')
				return
			}
			visited.add(node)

			for (const t of types){
				yield [subject, RDFS_TYPE_NODE,
					   { interfaceName: 'NamedNode', nominalValue: t }]
			}

			for (const n of iterPropNodes()){
				const val = getValue(n),
					  obj = val.subject || { interfaceName: 'Literal', nominalValue: val }
				for (const name of splitGet(n, 'itemprop')){
					// Z.debug('name: '+name+' base: '+base)
					const pred = { interfaceName: 'NamedNode',
								   nominalValue: resolveURI(name, base)}
					if (!subject || !name || !obj) Z.debug(['Invalid triple...: ', subject, name, obj])
					yield [subject, pred, obj]
					if (name === ADD_TYPE) yield [subject, RDFS_TYPE_NODE, obj]
				}
				if (val.subject/*isScope*/) yield* val.triples(depth-1, visited)
			}
		}

		function* iterPropNodes(){ // yields prop-holding-node
			yield* subs(node)

			for (const ref of splitGet(node, 'itemref')){
				for (const n of doc.querySelectorAll('#'+ref)){
					yield n
					yield* subs(n)
				}
			}

			function* subs(node){
				// Walk property nodes, excluding those in nested itemscopes
				// This uses the CSS :scope feature from working draft
				// https://drafts.csswg.org/selectors-4/#scope-element
				const nested = new Set(node.querySelectorAll(':scope [itemscope] [itemprop]'))
				for (const n of node.querySelectorAll('[itemprop]')){
					if (!nested.has(n)) yield n
				}
				// (XPath) .//*[@itemprop] except .//*[@itemscope]//*[@itemprop]
			}
		}
	}

	function parseValue(node){
		// https://www.w3.org/TR/microdata/#values
		// Return simple literals as Zotero makes no use of RDF typed literals
		switch (node.tagName.toLowerCase()) {
			case 'meta':
				return node.getAttribute('content')
			case 'audio':
			case 'embed':
			case 'iframe':
			case 'img':
			case 'source':
			case 'track':
			case 'video':
				return node.src
			case 'a':
			case 'area':
			case 'link':
				// resolve urls; should do the same for .src and .data
				return node.href
			case 'object':
				return node.data
			case 'data':
			case 'meter':
				return node.getAttribute('value')
			case 'time':
				return node.getAttribute('datetime')
		}
		return node.getAttribute('content') || node.textContent
	}

	function splitGet(node, name){
		const x = (node.getAttribute(name) || '').trim()
		return x ? x.split(/\s+/) : []
	}

}

function mixinEM(doc, url, itemType, cb) {
	// TODO: if so:mainEntityOfPage relates a bibliographic item to the page being parsed,
	// apply to it the metadata collected by EM
	var em = Zotero.loadTranslator('web')
	em.setTranslator('951c027d-74ac-47d4-a107-9c3069ab7b48') // Embedded Metadata
	em.setDocument(doc)
	em.setHandler('itemDone', function (trans, item) {
		cb(item)
	})
	em.getTranslatorObject(function(trans) {
		trans.itemType = itemType
		trans.doWeb(doc, url)
	})
}

function askImportRDF(triples){
	const rdf = Z.loadTranslator("import")
	rdf.setTranslator("5e3ad958-ac79-463d-812b-a86a9235c28f")
	rdf.getTranslatorObject(function(rdfObj) {
		const rdfStore = rdfObj.Zotero.RDF
		for (let t of triples) {
			t = [ t[0].nominalValue, t[1].nominalValue,
				  t[2].nominalValue, t[2].interfaceName=='Literal' ]
			rdfStore.addStatement(...t)
		}
		Z.debug(rdfStore.serialize("rdf/n3"))
		// TODO: smush RDF graph, at least according to so:sameAs relation
		rdfObj.defaultUnknownType = undefined // override setting from EM
		rdfObj.doImport(Z.selectItems.bind(Z))
	})
}


//** BEGIN TEST CASES **/
var testCases = []
/** END TEST CASES **/
