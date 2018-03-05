#! /usr/bin/env node

var Project = require("../lib/project");
var DB = require("../lib/db");
var Argv = require("optimist").boolean("cors").argv;

/***
	Run the program in CLI like:
	  node main.js -p <jenkins_job_workspace_path> -b <branch_name>
	Or
	  node main.js <jenkins_job_workspace_path> <branch_name>
	Or
	  sccd <jenkins_job_workspace_path> <branch_name> //on jenkins server
	Or
	  sccd -p <jenkins_job_workspace_path> -b <branch_name> //on jenkins server
	You can get the first CLI parameter through process.argv[2]
*/
if (Argv.h || Argv.help) {
  	console.log([
  		'',
	    'usage: node main.js [options]',
	    '',
	    'options:',
	    '  -p           Jenkins job workspace path. e.g.:/var/lib/jenkins/workspace/B1_SMP_PUM',
	    '  -b           Branch which test case run on [master]',
	    '  -h --help    Print this list and exit.'
  	].join('\n'));
  	process.exit();
}

function getTimestamp(oDate){
	var sYear = oDate.getFullYear();
	var sMonth = oDate.getMonth() + 1;
	var sDay = oDate.getDate();
	var sHour = oDate.getHours();
	var sMin = oDate.getMinutes();
	var sSec = oDate.getSeconds();
	
	sMonth = sMonth < 10 ? ("0" + sMonth):sMonth;
	sDay = sDay < 10 ? ("0" + sDay):sDay;
	sHour = sHour < 10 ? ("0" + sHour):sHour;
	sMin = sMin < 10 ? ("0" + sMin):sMin;
	sSec = sSec < 10 ? ("0" + sSec):sSec;

	return String(sYear) + String(sMonth) + String(sDay) + String(sHour) + String(sMin) + String(sSec);
}

var aArgv = process.argv.slice(2);

var oProject = new Project({
	workSpace: Argv.p || aArgv[0] || "./" //Use "../data/B1_SMP_PUM" as debug purpose
	//workSpace: "../data/B1_SMP_PUM"
});
var oDB = new DB({
	name: "sccd"
});

//${GIT_BRANCH} has a prefix "origin/", while ${GERRIT_BRANCH} does not
var sBranch = "master";
if(Argv.b && Argv.b.match(/^.*\/(\w+)$/)){
	sBranch = (Argv.b.match(/^.*\/(\w+)$/))[1];
}else if(Argv.b){
	sBranch = Argv.b;
}else if(aArgv[1] && aArgv[1].match(/^.*\/(\w+)$/)){
	sBranch = (aArgv[1].match(/^.*\/(\w+)$/))[1];
}else if(aArgv[1]){
	sBranch = aArgv[1];
}
console.log("Get branch name: " + sBranch);


//Save project information
oProject.getProjectId().then(function(sProjectId){	
	oDB.connect();
	//Check project record exist or not
	sSqlCheck = "SELECT pid FROM Project WHERE pid=?";
    aParamCheck = [sProjectId];
    oDB.query(sSqlCheck, aParamCheck, function(oError, aRow){
    	if(oError){
    		console.log("Check project " + sProjectId + " existence failed. Message: " + oError.message);
    		return;
    	}
    	
    	var sSqlSave, aParamSave;
    	if(aRow.length === 0){ //Insert a new test result
    		var sProjectName = sProjectId.substr(sProjectId.lastIndexOf(".")+1);
    		console.log("Create a project, id: " + sProjectId + ", name: " + sProjectName);
			sSqlSave = "INSERT INTO Project(pid, name) VALUES(?,?)";
            aParamSave = [sProjectId, sProjectName];

            var oDBSave = new DB({
				name: "sccd"
			});
			oDBSave.connect();
	    	oDBSave.query(sSqlSave, aParamSave, function(oError, oResult){
	        	if(oError){
	        		console.log("DB error:" + oError.message);
	        		return;
	        	}
	        	console.log("Save project id: " + sProjectId + ", name: " + sProjectName + " successfully.");
	        });
	        oDBSave.close();
    	}else{
    		console.log("Project " + sProjectId + " exist yet.");
    	}
    });          
	oDB.close();
}).catch(function(sReason){
	console.log("Save project information failed: " + sReason);
	oDB.close();
});


//Save project test KPI
Promise.all([oProject.getProjectId(), oProject.getTestKpi(), oProject.getUTCoverage()]).then(function(aResult){
	var sProjectId = aResult[0], oKpi = aResult[1], oCoverage = aResult[2];
	var sTimestamp = getTimestamp(new Date());

	console.log("Get project id: " + sProjectId);

	oDB.connect();
	(Object.keys(Project.TestType)).forEach(function(sTestTypeKey){
		var sSqlCheck, aParamCheck;
		var sTestType = Project.TestType[sTestTypeKey];

		if(oKpi[sTestType].assertion){
			console.log("Get " + sTestType + " test kpi: passed-" + oKpi[sTestType].passed + ", " +
														"failed-" + oKpi[sTestType].failed + ", " +
														"skipped-" + oKpi[sTestType].skipped + ", " +
														"assertion-" + oKpi[sTestType].assertion +
														(sTestType === Project.TestType.Unit ?
															(", included stmt lines-" + oCoverage.Included.validLines + ", " + 
															"included stmt coverage-" + oCoverage.Included.lineRate + ", " + 
															"all stmt lines-" + oCoverage.All.validLines + ", " + 
															"all stmt coverage-" + oCoverage.All.lineRate):"")
														);

			//Check test kpi of today has been recorded or not
			sSqlCheck = "SELECT tcid FROM " + sTestType +
				   " WHERE pid=? AND timestamp LIKE '" + sTimestamp.slice(0,8) +"%'" +
				   " ORDER BY timestamp desc";
		    aParamCheck = [sProjectId];
		    oDB.query(sSqlCheck, aParamCheck, function(oError, aRow){
            	if(oError){
            		console.log("Check " + sProjectId + "-" + sTimestamp.slice(0,8) + " test kpi existence failed. Message: " + oError.message);
            		return;
            	}
            	
            	var sSqlSave, aParamSave;
            	var aCoverage = [oCoverage.Included.validLines, oCoverage.Included.lineRate, oCoverage.All.validLines, oCoverage.All.lineRate];
            	if(aRow.length){ //Update the record with the latest test result
            		console.log("Update an existing " + sTestType +" test result: tcid = " + aRow[0].tcid + ", timestamp = " + sTimestamp);
            		sSqlSave = "UPDATE " + sTestType +
            			   " SET pid=?, branch=?, passed=?, failed=?, skipped=?, assertion=?, timestamp=?" +
            			   (sTestType === Project.TestType.Unit ? ", inclstmtlines=?, inclstmtcover=?, allstmtlines=?, allstmtcover=?" : "") +
            			   " WHERE tcid=?";
            		aParamSave = [sProjectId, sBranch, oKpi[sTestType].passed, oKpi[sTestType].failed, oKpi[sTestType].skipped,
		            			oKpi[sTestType].assertion, sTimestamp].concat(
		            				(sTestType === Project.TestType.Unit ? aCoverage : []),
		            				[aRow[0].tcid]
		            			);
            	}else{ //Insert a new test result
            		console.log("Create a new " + sTestType +" test result: timestamp = " + sTimestamp);
					sSqlSave = "INSERT INTO " + sTestType + 
					       "(pid, branch, passed, failed, skipped, assertion, timestamp" +
					       (sTestType === Project.TestType.Unit ? ", inclstmtlines, inclstmtcover, allstmtlines, allstmtcover" : "") +
					       ")" +
					       " VALUES(?,?,?,?,?,?,?" +
					       (sTestType === Project.TestType.Unit ? ",?,?,?,?" : "") +
					       ")";
		            aParamSave = [sProjectId, sBranch, oKpi[sTestType].passed, oKpi[sTestType].failed, oKpi[sTestType].skipped,
		            			oKpi[sTestType].assertion, sTimestamp].concat(
		            				(sTestType === Project.TestType.Unit ? aCoverage : [])
		            			);
            	}

				var oDBSave = new DB({
					name: "sccd"
				});
				oDBSave.connect();
            	oDBSave.query(sSqlSave, aParamSave, function(oError, oResult){
	            	if(oError){
	            		console.log("DB error:" + oError.message);
	            		return;
	            	}
	            	console.log("Save " + sTestType +" test kpi successfully.");
	            });
	            oDBSave.close();
            });
		}
	});
	oDB.close();
}).catch(function(sReason){
	console.log("Save test kpi failed: " + sReason);
	oDB.close();
});
