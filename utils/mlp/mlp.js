#!/usr/bin/env nodejs

var mlstatic_path='../../../mlserver/mlstatic';
JobManager=require(mlstatic_path+'/public/mlpipeline/jobmanager.js').JobManager;
Job=require(mlstatic_path+'/public/mlpipeline/jobmanager.js').Job;
ProcessorManager=require(mlstatic_path+'/public/mlpipeline/managers/processormanager.js').ProcessorManager;
MLPDocument=require(mlstatic_path+'/public/mlpipeline/mlpdocument.js').MLPDocument;
JSQ=require(mlstatic_path+'/public/mlpipeline/jsq/src/jsqcore/jsq.js').JSQ;
KuleleClient=require(mlstatic_path+'/public/mlpipeline/kuleleclient.js').KuleleClient;

var txt=require('fs').readFileSync('/home/magland/Downloads/synth.mlp','utf-8');
var obj=JSON.parse(txt);

var doc=new MLPDocument();
doc.fromObject(obj);
var PLM=doc.pipelineListManager();
var input_file_manager=doc.inputFileManager();
var output_file_manager=doc.outputFileManager();

var job_manager=new JobManager();
var processor_manager=new ProcessorManager();
var kulele_client=new KuleleClient();
var larinetserver=require(__dirname+'/../processing_server/larinet/larinetserver.js').larinetserver;
kulele_client.setLarinetServer(larinetserver);
kulele_client.setProcessorManager(processor_manager);

job_manager.setProcessorManager(processor_manager);
job_manager.setDocument(doc);
job_manager.setKuleleClient(kulele_client);

//kulele_client.setSubserverName(doc.processingServerName());
/*
kulele_client.login({passcode:'testuser'},function(tmp) {
	if (!tmp.success) {
		console.err('Error logging in: '+tmp.error);
		return;
	}
*/	
	kulele_client.getProcessorSpec(function(tmp) {
		if (tmp.success) {
			processor_manager.setSpec(tmp.spec);
			step2();
		}
		else {
			console.error('Error getting processor spec: '+tmp.error)
		}
	});
//});


function step2() {
	var pipeline0=PLM.findPipeline('main');
	if (!pipeline0) {
		console.err('Unable to find main pipeline in document.');
		return;
	}
	for (var i=0; i<pipeline0.stepCount(); i++) {
		var step0=pipeline0.step(i);
		start_job(step0,'main');
	}

	function start_job(step,parent_pipeline_name) {
		var job=new Job();

		JSQ.connect(job,'status_changed',new JSQObject(),function() {
			var name0=step.processor_name||step.pipeline_name;
			console.log ('=== '+name0+': '+job.status()+' : '+job.error());
		});

		job.setJobManager(job_manager);
		job.setStep(step);
		job.setParentPipelineName(parent_pipeline_name);
		job._setStatus('pending');
		var spec=job.getSpec();
		if (!spec) {
			console.err('Unable to get spec for job.');
			return;
		}
		wait_for_ready_to_run_and_set_up_job(job,function(tmp) {
			if (!tmp.success) {
				console.err('Error setting up job: '+tmp.error);
				return;
			}
			job.start(job_manager);
		});
	}

	function wait_for_ready_to_run_and_set_up_job(job,callback) {
		var spec=job.getSpec();
		var step=job.step();
		var input_files={};
		for (var i in spec.inputs) {
			var input0=spec.inputs[i];
			if (step.inputs[input0.name]) {
				var prvrec=input_file_manager.prvRecord(step.inputs[input0.name]);
				if (!prvrec) {
					prvrec=find_input_file(job.parentPipelineName(),step.inputs[input0.name]);
				}
				if (prvrec) {
					input_files[input0.name]=prvrec;
				}
				else {
					if (input_file_is_pending(job.parentPipelineName(),step.inputs[input0.name])) {
						setTimeout(function() {
							wait_for_ready_to_run_and_set_up_job(job,callback)
						},100);
						return;
					}
					else {
						job._setStatus('error');
						job._setError('Unable to find required input: '+step.inputs[input0.name]);
						return;
					}
				}
			}
		}
		var parameters={};
		for (var i in spec.parameters) {
			var param0=spec.parameters[i];
			if (param0.name in step.parameters) {
				parameters[param0.name]=step.parameters[param0.name];
			}
			else {
				if (!param0.optional) {
					job._setStatus('error');
					job._setError('Unable to find required parameter: '+param0.name);
					return;	
				}
			}
		}
		job._setInputFiles(input_files);
		job._setParameters(parameters);
		callback({success:true});
	}
	function find_input_file(pipeline_name,file_name) {
		var pipeline0=doc.pipelineListManager().findPipeline(pipeline_name);
		if (!pipeline0) return null;
		for (var i=0; i<pipeline0.stepCount(); i++) {
			var step0=pipeline0.step(i);
			for (var oname in step0.outputs) {
				if (step0.outputs[oname]==file_name) {
					var job=job_manager.findLastJobForStep(pipeline_name,step0);
					if (!job) return null;
					if (job.status()=='finished') {
						return job.outputFiles()[oname];
					}
				}
			}
		}
		return null;
	}
	function input_file_is_pending(pipeline_name,file_name) {
		var pipeline0=doc.pipelineListManager().findPipeline(pipeline_name);
		if (!pipeline0) return false;
		for (var i=0; i<pipeline0.stepCount(); i++) {
			var step0=pipeline0.step(i);
			for (var oname in step0.outputs) {
				if (step0.outputs[oname]==file_name) {
					var job=job_manager.findLastJobForStep(pipeline_name,step0);
					if ((job.status()=='finished')||(job.status()=='running')||(job.status()=='pending')) {
						return true;
					}
				}
			}
		}
		return false;
	}
}