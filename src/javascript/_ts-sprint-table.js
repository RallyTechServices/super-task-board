/**
 */
 
 Ext.define('Rally.technicalservices.SprintTable', {
    extend: 'Ext.Container',
    alias: 'widget.tssprinttable',

    requires: ['Rally.technicalservices.IconUtility'],
    
    /**
     * @property {String} cls The base class applied to this object's element
     */
    cls: "tssprint",

    config: {
        /**
         * @cfg {Ext.data.Model} iteration 
         *
         */
        iteration: null,
        /**
         * 
         * @cfg String
         * 
         * The name of the field that is used for the task columns
         * 
         */
        taskStateField: 'State',
        /**
         * 
         * @cfg {object} 
         * Has a key for each allowed value in taskStateField and values for show and a task State to map to it
         * 
         */
        columnSettings: null

    },
    
    /**
     * @constructor
     * @param {Object} config
     */
    constructor: function (config) {
        this.mergeConfig(config);
        
        this.callParent([this.config]);
    },

    initComponent: function () {
        var me = this;
        this.callParent(arguments);
        
        this.addEvents(
            /**
             * @event
             * Fires when the grid has been rendered
             * @param {Rally.technicalservices.SprintTable} this
             * @param {Rally.ui.grid.Grid} grid
             */
            'gridReady'
        );
        
        this._getFieldValues('task',this.taskStateField).then({
            success: function(task_values) {
                var columns = this._getColumns(task_values);
                this._defineCustomModel(columns);
                
                var table_store = Ext.create('Rally.data.custom.Store',{
                    model: 'TSTableRow'
                });
                
                this.grid = this.add({ 
                    xtype:'rallygrid', 
                    store: table_store,
                    columnCfgs: columns,
                    showPagingToolbar : false,
                    showRowActionsColumn : false,
                    sortableColumns: false,
                    disableSelection: true,
                    enableColumnMove: false,
                    viewConfig: {
                        listeners: {
                            scope: this,
                            itemupdate: function(row) {
                                var tasks = row.get('__Tasks') || [];
                                var defects = row.get('__Defects') || [];
                                
                                var items = Ext.Array.push(tasks,defects);
                                
                                Ext.Array.each(items, function(record) {
                                    var record_oid = record.ObjectID || record.get('ObjectID');
                                    this._createTaskCard(record_oid,record);
                                },this);
                            }
                        },
                        plugins: {
                            ptype: 'tscelldragdrop'
                        }
                    },
                    enableColumnHide: true /* doesn't do anything yet */
                });
                
                this._loadCards();
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem finding valid field values', msg);
            },
            scope: this
        });
        
    },
    
    _loadCards: function() {
        var me = this;
        
        Deft.Chain.sequence([
            function() { return me._loadWorkItems('HierarchicalRequirement'); },
            function() { return me._loadWorkItems('Defect'); }
        ]).then({
            scope: this,
            success: function(results) {
                var records = Ext.Array.flatten(results);
                
                this._updateRows(records, this.grid.getStore()).then({
                    scope: this,
                    success: function(rows) {
                        this._addTaskCards(rows);
                        this._setWorkItemCardListeners(rows);
                    }
                });
            },
            failure: function(msg) {
                Ext.Msg.alert("Problem Loading Iteration Work Items", msg);
            }
        });
        
    },

    _loadWorkItems: function(artifact_type) {
        var deferred = Ext.create('Deft.Deferred');
        
        var iteration_filter = [{property:'Iteration',value:''}];
        if ( this.iteration ) {
            iteration_filter = [{property:'Iteration.Name', value:this.iteration.get('Name')}];
        }
        
        var store = Ext.create('Rally.data.wsapi.Store',{
            model: artifact_type,
            context: { projectScopeDown: false, projectScopeUp: false },
            sorters: [{property:'DragAndDropRank',direction:'ASC'}],
            filters: iteration_filter,
            fetch: ['FormattedID', 'Name', 'ObjectID','Owner','PlanEstimate',
                'Blocked','Owner','BlockedReason','Description']
        });
                
        store.load({
            scope: this,
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    deferred.reject( operation.error.errors.join('. ') );
                }
            }
        });
        return deferred.promise;
    },
    
    _defineCustomModel: function(columns) {
        var me = this;
        
        var task_state_field = this.taskStateField;
        var columnSettings = this.columnSettings;
        
        var fields = Ext.Array.map(columns, function(column){
            var name = column.dataIndex;
            var type = 'object';
            return { name: name, type: type };
        });
        
        fields.push({ name: '__Tasks', type: 'object', defaultValue: []});
        fields.push({ name: '__Defects', type: 'object', defaultValue: []});
        
        Ext.define('TSTableRow', {
            extend: 'Ext.data.Model',
            fields: fields,
            
            addTasks: function(tasks) {
                Ext.Array.each(tasks, function(task){
                    var state = task.get(task_state_field);
                    if ( Ext.isEmpty(this.get(state)) ) {
                        this.set(state, [task.getData()]);
                    } else {
                        var saved_tasks = this.get(state);
                        saved_tasks.push(task.getData());
                        this.set(state, saved_tasks);
                    }
                    
                    var old_tasks = this.get('__Tasks') || [];
                    var total_tasks = Ext.Array.merge( old_tasks, [task]);
                    this.set('__Tasks',total_tasks);
                },this);
            },
            
            addDefects: function(defects) {
                Ext.Array.each(defects, function(defect){
                    var state = defect.get(task_state_field);
                    if ( Ext.isEmpty(this.get(state)) ) {
                        this.set(state, [defect.getData()]);
                    } else {
                        var saved_defects = this.get(state);
                        saved_defects.push(defect.getData());
                        this.set(state, saved_defects);
                    }
                    
                    var old_defects = this.get('__Defects') || [];
                    var total_defects = Ext.Array.merge( old_defects, [defect]);
                    this.set('__Defects',total_defects);
                },this);
            },
            
            changeTaskColumn: function(record, source_column, target_column) {
                // remove from existing column list in row record
                var old_column_items = this.get(source_column) || [];
                var new_column_items = this.get(target_column) || [];
                var record_data = record.getData();
                
                new_column_items.push(record_data);
                this.set(target_column, new_column_items);
                
                this.set(source_column, 
                    Ext.Array.filter(old_column_items, function(old_item) {
                        return ( old_item.ObjectID != record_data.ObjectID );
                    })
                );
                
                this.setItemField(record, task_state_field, target_column);
            },
            
            setItemField: function(record, field_name, value) {
                record.set(field_name, value);
                
                if ( record.get('_type') == 'task' && field_name !== "State" && field_name == task_state_field && !Ext.isEmpty( columnSettings )) {
                    var setting = columnSettings[value];
                    if ( !Ext.isEmpty(setting['stateMapping'])) {
                        record.set('State', setting['stateMapping']);
                    }
                }
                record.save();
            }
        });
    },
    
    _createTaskCard: function(record_oid, record){
        
        var me = this;
        var tasks = Ext.query('#' + record_oid);
        
        if ( tasks.length === 0 ) {
            console.log('Cannot find card for task', record_oid);
        } else {
            var card_element = Ext.get(tasks[0]);

            var card = Ext.create('Rally.technicalservices.sprintboard.TaskCard',{
                record: record,
                renderTo: card_element
            });
            
            card_element.on('click', function(evt,c) {
                this._showQuickView(record);
            },this);
        }
    },
    
    
    taskTemplate: new Ext.XTemplate(
        "<tpl for='.'>",
            '<tpl if="this.hasColor(DisplayColor)">',
                "<div id='{ObjectID}' class='ts_task_card {_type} {[this.getBlockedClass(values.Blocked)]}' style='background-color:{DisplayColor};color:white;'>",
            '<tpl else>',
                "<div  id='{ObjectID}'  class='ts_task_card {_type} {[this.getBlockedClass(values.Blocked)]}' style='color:black;'>",
            '</tpl>',
        
            "{Name:ellipsis(15, true)}</div>",
        "</tpl>",
        {
            hasColor: function(color){
               return !Ext.isEmpty(color);
            },
            
            getBlockedClass: function(blocked) {
                if ( blocked !== true ) {
                    return "";
                }
                return "blocked";
            }
        }
    ),
    
    workproductTemplate: new Ext.XTemplate(
        "<tpl for='.'>",
            '<div class="x4-component rui-card {_type} x4-border-box xdrag-handle cardboard {[this.getBlockedClass(values.Blocked)]}">',
                '<div class="artifact-color"></div>',
                '<div class="card-table-ct {_type}" id="{ObjectID}" type={_type}">',
                    '<table class="card-table column-container">',
                        '<tr>',
                            '<td class="rui-card-content">',
                                '<div class="left-header">',
                                    '<div class="id" style="min-width: 68px">',
                                        '<span class="formatted-id-template">',
                                            '<a class="formatted-id-link" href="{[this.getArtifactURL(values)]}">',
                                                '<span class="{[this.getArtifactIcon(values)]}"> </span> {FormattedID}',
                                            '</a>',
                                        '</span>',
                                    '</div> ',
                                    '<div class="owner-name">{[this.getOwnerName(values.Owner)]}</div>',
                                '</div>',
                                '<div class="field-content Name type-string">',
                                    '<div class="rui-field-value">{Name}</div>',
                                '</div>',
                            '</td>',
                            
                            '<td class="rui-card-right-side has-estimate">',
                                '<div class="right-top-side">',
                                    '<div class="card-owner-field">',
                                        '<div class="field-content Owner">',
                                            '<div class="rui-field-value">',
                                                '{[this.getOwnerImage(values.Owner)]}',
                                            '</div>',
                                        '</div>',
                                    '</div>',
                                '</div>',
                                '<div class="right-bottom-side">',
                                '<div class="card-estimate-field">',
                                    '<div class="field-content PlanEstimate xeditable" >',
                                        '<div class="rui-field-value">{PlanEstimate}</div>',
                                    '</div>',
                                '</div>',
                            '</div>',
                            '</td>',
                            
                        '<tr/>',
                    '</table>',
               '</div>',
            '</div>',
        "</tpl>",
        {
            getArtifactURL: function(record){
                return Rally.nav.Manager.getDetailUrl(record);
            },
            
            getBlockedClass: function(blocked) {
                if ( blocked !== true ) {
                    return "";
                }
                return "blocked";
            },
            getOwnerName: function(owner) {
                if ( Ext.isEmpty(owner) ) {
                    return "--";
                }
                return owner._refObjectName;
            },
            getOwnerImage: function(owner) {
                if (Ext.isEmpty(owner)) {
                    return " ";
                }
                return Ext.String.format('<img class=" card-owner-img" src="/slm/profile/image/{0}/25.sp">', 
                    owner.ObjectID);
            },
            getArtifactIcon: function(record) {
                var type = record._type;
                
                return Rally.technicalservices.IconUtility.getIconForType(type);
            }
        }
    ),
    
    _getColumns: function(task_states) {
        var me = this;
        
        var columns = [{
            dataIndex: '__WorkProduct',
            text: 'Features',
            flex: 1,
            align: 'center',
            renderer: function(value) {
                return me.workproductTemplate.apply([value.getData()]);
            }
        }];
        
        Ext.Array.each(task_states, function(state){
            columns.push({
                dataIndex: state,
                text: state || "No Entry",
                flex: 1,
                align: 'center',
                renderer: function(value) {
                    var html = [];
                    
                    Ext.Array.each(value, function(item){
                        html.push(
                            Ext.String.format(
                                '<div id="{0}" style="height:37px;float: left;"></div>',
                                item.ObjectID
                            )
                        );
                    });
                    
                    //return me.taskTemplate.apply(value);
                    return html.join('\n');
                }
            });
        });
        
        return columns;
    },
    
    _updateRows: function(workproducts, table_store) {
        var deferred = Ext.create('Deft.Deferred');
        var me = this;

        
        Deft.Chain.sequence([
            function() { return me._loadTasks(workproducts); },
            function() { return me._loadChildDefects(workproducts); }
        ]).then({
            scope: this,
            success: function(results) {
                var me = this;
                var tasks_by_workproduct = results[0];
                var defects_by_workproduct = results[1];
                
                var rows = this._getRowsFromWorkproducts(workproducts,tasks_by_workproduct,defects_by_workproduct);

                table_store.loadRecords(rows);
                
                this.fireEvent('gridReady', this, this.grid);
                deferred.resolve(rows);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem loading artifacts', msg);
                deferred.reject();
            }
        });
        return deferred.promise;
    },
    
    _loadChildDefects: function(workproducts) {
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var promises = [];
        
        Ext.Array.each(workproducts, function(workproduct){
            var oid = workproduct.get('ObjectID');
            promises.push( function() { return me._loadDefectsForArtifact(oid); } );
        });
        
        Deft.Chain.sequence(promises).then({
            scope: this,
            success: function(defect_array) {
                var defects_by_workproduct = {};
                // collapse an array of hashes into one hash
                Ext.Array.each(defect_array, function(defects_by_a_workproduct){
                    defects_by_workproduct = Ext.apply(defects_by_workproduct, defects_by_a_workproduct);
                });
                
                deferred.resolve( defects_by_workproduct );
            },
            failure: function(msg) {
                deferred.reject(msg)
            }
        });
        
        return deferred.promise;
    },
    
    _loadTasks: function(workproducts) {
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        
        var workproducts_by_oid = {};
        Ext.Array.each(workproducts, function(workproduct){
            var oid = workproduct.get('ObjectID');
            workproducts_by_oid[oid] = workproduct;
        });
        
        var iteration_filter = [{property:'Iteration',value:''}];
        if ( this.iteration ) {
            iteration_filter = [{property:'Iteration.Name', value:this.iteration.get('Name')}];
        }
        
        var task_store = Ext.create('Rally.data.wsapi.Store',{
            model: 'Task',
            context: { projectScopeDown: false, projectScopeUp: false },
            sorters: [{property:'TaskIndex',direction:'ASC'}],
            filters: iteration_filter,
            fetch: ['FormattedID', 'Name', 'ObjectID','DisplayColor',
                'Project',this.taskStateField, 'Owner', 'Blocked', 'BlockedReason',
                'Estimate','ToDo','WorkProduct']
        });
        
        task_store.load({
            scope: this,
            callback : function(records, operation, successful) {
                if (successful){
                    var tasks_by_workproduct = {};
                    Ext.Array.each(records, function(record){
                        var workproduct_oid = record.get('WorkProduct').ObjectID;
                        if ( Ext.isEmpty(tasks_by_workproduct[workproduct_oid]) ) {
                            tasks_by_workproduct[workproduct_oid] = [];
                        }
                        tasks_by_workproduct[workproduct_oid].push(record);
                    });
                    deferred.resolve(tasks_by_workproduct);
                } else {
                    console.error('Problem loading: ' + operation.error.errors.join('. '));
                    Ext.Msg.alert('Problem loading milestones', operation.error.errors.join('. '));
                }
            }
        });
        
        return deferred.promise;
    },
    
    _getRowsFromWorkproducts: function(workproducts,tasks_by_workproduct,defects_by_workproduct) {
        var rows = [];
        var me = this;
        
        Ext.Array.each( workproducts, function(workproduct){
            var row = Ext.create('TSTableRow',{
                __WorkProduct: workproduct,
                __Tasks: [],
                __Defects: []
            });
            
            row.addTasks(tasks_by_workproduct[workproduct.get('ObjectID')] || []);
            row.addDefects(defects_by_workproduct[workproduct.get('ObjectID')] || []);
            
            rows.push(row);
        });
        
        return rows;
    },
    
    _loadDefectsForArtifact: function(oid) {
        var deferred = Ext.create('Deft.Deferred');
        
        var config = {
            model: 'Defect',
            fetch: ['FormattedID', 'Name', 'ObjectID','Owner','PlanEstimate','DisplayColor',
                'Blocked','Owner','BlockedReason','Description',this.taskStateField],
            filters: [{property:'Requirement.ObjectID', value: oid}]
        };
        
        TSUtilities.loadWSAPIItems(config).then({
            scope: this,
            success: function(tasks) {
                var defects_by_workproduct = {};
                defects_by_workproduct[oid] = tasks;
                deferred.resolve(defects_by_workproduct);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });

        return deferred;
    },
    
    _getFieldValues: function(model_name,field_name){
        var deferred = Ext.create('Deft.Deferred');
        
        Rally.data.ModelFactory.getModel({
            type: model_name,
            success: function(model) {
                model.getField(field_name).getAllowedValueStore().load({
                    callback: function(records, operation, success) {
                        var valid_values = Ext.Array.map(records, function(allowed_value){
                            return allowed_value.get('StringValue');
                        });
                        deferred.resolve(valid_values);
                    }
                });
            }
        });
        return deferred;
    },
    
    _addTaskCards: function(rows) {
        Ext.Array.each(rows, function(row){
            
            var tasks = row.get('__Tasks') || [];
            var defects = row.get('__Defects') || [];
            
            var items = Ext.Array.push(tasks,defects);
            
            Ext.Array.each(items, function(record) {
                var record_oid = record.get('ObjectID');
                this._createTaskCard(record_oid,record);
            },this);
        },this);
    },
    
    _setWorkItemCardListeners: function(rows) {
        Ext.Array.each(rows, function(row){
            var record = row.get('__WorkProduct');
            var record_oid = record.get('ObjectID');
            var cards = Ext.query('#' + record_oid);
            
            if ( cards.length === 0 ) {
                console.log('Cannot find card for work item', record_oid);
            } else {
                var card_element = Ext.get(cards[0]);
                card_element.on('click', function(evt,c) {
                    this._showQuickView(record);
                },this);
            }
        },this);
    },
    
    _showQuickView: function(record) {
        var me = this;
        Ext.create('Rally.technicalservices.artifact.EditDialog', {
            record: record
        }).show();
    }
    

});
