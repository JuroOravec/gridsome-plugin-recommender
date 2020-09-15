const _ = require("lodash");
const pluginName = require("./package.json").name;
const ContentBasedRecommender = require('content-based-recommender');

class RecommenderPlugin {

    static defaultOptions() {
        return {
            enabled: true,
            /**
             * {typeName} is the name of the collection
             * we relate to
             * required
             */
            typeName: undefined,
            /**
             * {field} is the collection field we
             * train our model with
             * required
             */
            field: undefined,
            /**
             * relation field name that gets added to the collection
             * containing all related elements
             */
            relatedFieldName: 'related',
            /**
             * {minScore} is the minimum similarity score
             * required for being considered "similar"
             */
            minScore: 0.01,
            maxScore: 1,
            /**
             * {maxRelations} is the number of relations to be produced
             * per node as a maximum
             */
            maxRelations: 10,
            /**
             * {minRelations} is the number of relations to be produced
             * per node as a minimum. As a consequence nodes are factored in
             * that might not be related as fillers to reach this number
             */
            minRelations: 3,
            /**
             * {fillWIthUnrelated} will always fill relations per node
             * to {minRelations} with random nodes
             */
            fillWithUnrelated: false,
            debug: false
        }
    }

    constructor(api, options) {
        this.api = api;
        this.validateOptions(options);
        this.options = Object.assign(RecommenderPlugin.defaultOptions(), options);

        if (!this.options.enabled) return;

        this.recommender = new ContentBasedRecommender({
            minScore: this.options.minScore,
            maxSimilarDocuments: this.options.maxRelations
        });

        api.loadSource(this.loadSource.bind(this))
    }

    /**
     * Validations for user-defined options in gridsome.config.js
     *
     * @param options
     */
    validateOptions(options) {
        if (options === undefined) throw `Options not defined for ${pluginName}`
        if (!options.typeName) throw `${pluginName}: You need to define options.collection in your options you want to create recommendations for`;
        if (!options.field) throw `${pluginName}: You need to define options..field in your options you want to create recommendations for`;
        if (!options.minScore && !_.inRange(options.minScore, 0, 1)) throw `${pluginName}: options.minScore need to be in range between [0,1]`;
        if (!options.maxScore && !_.inRange(options.maxScore, 0, 1)) throw `${pluginName}: options.maxScore need to be in range between [0,1]`;
        if (!options.maxRelations && !_.inRange(options.maxRelations, 0, 100)) throw `${pluginName}: options.maxRelations need to be in range between [0,100]`;
        if (!options.minRelations && !_.inRange(options.minRelations, 0, 100)) throw `${pluginName}: options.minRelations need to be in range between [0,100]`;
    }

    /**
     * Load all nodes from given collection
     *
     * @param actions
     */
    loadSource(actions) {
        const context = this;
        const collection = actions.getCollection(this.options.typeName);

        if (!collection) throw `${pluginName}: options.typeName '${this.options.typeName}' cannot be found - make sure the collection exists`;

        this.train(collection);


        collection.data().forEach((node) => {
            let relations = this.fetchDocumentRelations.call(context, node.id);
            if (this.options.fillWithUnrelated && relations.length < this.options.minRelations) {
                this.log(`minRelations ${relations.length}/${this.options.minRelations} not reached - filling with random relations`)
                relations = this.fillWithRandomRelations(collection, relations);
            }
            this.createNodeRelations(collection, actions.store, node, relations);
        })
    }

    /**
     * Trains model based on given collection
     *
     * @param collection
     */
    train(collection) {
        let convertedDocuments = collection.data().map(this.convertNodeToDocument.bind(this));
        this.log("training", convertedDocuments);
        this.recommender.train(convertedDocuments);
    }

    /**
     * Convert node to document schema based on defined option.field
     *
     * TODO To be used with multiple fields, it might be enough to concatenate them to one string
     *
     * @param node
     * @returns {{id: *, content: *}}
     */
    convertNodeToDocument(node) {
        return {
            id: node.id,
            content: node[this.options.field]
        }
    }

    /**
     * Creates an array of related documents with similarity score
     *
     * @param id
     * @returns {[{id:1,score:1}]}
     */
    fetchDocumentRelations(id) {
        return this.recommender.getSimilarDocuments(id, 0, this.options.maxRelations);
    }

    /**
     * Better we have a list here to create fast subsets
     * Operate on collection or on documents or only on ids?
     * TODO
     *
     * @param collection
     * @param documentRelations
     */
    fillWithRandomRelations(collection, documentRelations) {
        const numElementsMissing = this.options.minRelations - documentRelations.length;
        const fillers = this.getArraySubsetExcluding(collection, documentRelations, numElementsMissing);
        return documentRelations.map(i => i.id).concat(fillers)
    }

    getArraySubsetExcluding(collection, toExclude, count) {
        const array = collection.data();
        const indices = [];
        const result = new Array(count);
        for (let i = 0; i < count; i++) {
            let j = Math.floor(Math.random() * (array.length - i) + i);
            result[i] = array[indices[j] === undefined ? j : indices[j]];
            indices[j] = indices[i] === undefined ? i : indices[i];
        }
        return result;
    }

    /**
     * Create node relations for one node in collection / GraphQl
     *
     * @param collection
     * @param store
     * @param node
     * @param documentRelations
     */
    createNodeRelations(collection, store, node, documentRelations) {
        this.log("createNodeRelations - ", "id ", node.id, " has relations ", documentRelations);
        let options = {...node};
        options[this.options.relatedFieldName] = documentRelations.map(relation => store.createReference(this.options.typeName, relation.id));
        collection.updateNode(options)
    }

    log() {
        if (this.options.debug) console.log(`${pluginName}: `, arguments);
    }

}

module.exports = RecommenderPlugin;
