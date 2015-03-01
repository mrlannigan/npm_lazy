'use strict';

var mapping = {},
    exec = require('child_process').exec,
    Package = require('./package'),
    logger = console,
    util = require('util'),
    fs = require('fs'),
    sha = require('sha'),
    BPromise = require('bluebird'),
    cachePath,
    execProm = BPromise.promisify(exec);

[
    'web-api-ad',
    'web-service-ad',
    'web-data-ad',
    'web-generic-service',
    'web-config',
    'web-data-queue',
    'web-service-auth',
    'web-service-location',
    'web-service-events',
    'web-service-geocodeip',
    'int-test-mocks'
].forEach(function (name) {
        mapping[name] = {
            name: name,
            repo: 'ssh://git@stash.homes.com:7999/has/'+name+'.git',
            rev: 'HEAD',
            packageJSON: null
        };
    });

[
    'hui-components-content',
    'hui-components-style',
    'hui-components-ui',
    'hui-cucumber-proof',
    'hui-dgeni-packages',
    'hui-grunt-build',
    'hui-guide',
    'hui-mobile',
    'hui-portal',
    'web-composer-hui-mobile',
    'web-composer-loco-dashboard'
].forEach(function (name) {
        mapping[name] = {
            name: name,
            repo: 'ssh://git@stash.homes.com:7999/hdc/'+name+'.git',
            rev: 'HEAD',
            packageJSON: null
        };
    });


exports.mapping = mapping;


exports.configure = function (opts) {
    if (opts.logger) {
        logger = opts.logger;
    }

    if (opts.cachePath) {
        cachePath = opts.cachePath;
    }
};


exports.getFullIndex = function (name, callback) {

    var repo = mapping[name],
        output;

    output = {
        _id: repo.name,
        name: repo.name,
        'dist-tags': {
            latest: repo.rev
        },
        versions: {}
    };

    exports.getIndex(repo.name, function (err, pack) {
        if (err) {
            return callback(err);
        }

        output.versions[pack.version] = pack;
        output['dist-tags'].latest = pack.version;
        return callback(null, output);
    });
};

exports.getIndex = function (name, callback) {
    var repo = mapping[name],
        output,
        ok = BPromise.resolve();

    repo.cacheFolder = cachePath+'/'+repo.name+ '-' + repo.rev;
    repo.cacheTarPath = cachePath+'/'+repo.name+ '-' + repo.rev + '.tgz';

    ok = ok.then(function () {
        var prom;

        if (!fs.existsSync(repo.cacheFolder)) {

            logger.log('[git][' + repo.name + '] Downloading repo');
            prom = execProm(util.format('git clone -q %s %s', repo.repo, repo.cacheFolder)).spread(function (stdout, stderr) {

                logger.log('[git][' + repo.name + '] DONE Downloading repo');
            });

        } else if (repo.rev == 'HEAD') {

            logger.log('[git][' + repo.name + '] Fetching latest updates from repo');
            prom = execProm('git fetch --all', {cwd: repo.cacheFolder}).spread(function (stdout, stderr) {

                logger.log('[git][' + repo.name + '] DONE Fetching repo');
            });

        } else {

            prom = BPromise.resolve();
        }

        prom = prom.then(function () {

            logger.log('[git]['+repo.name+'] Checking out to ' + repo.rev);
            return execProm(util.format('git checkout %s', repo.rev.replace('---', '/')), {cwd: repo.cacheFolder}).spread(function (stdout, stderr) {

                var outputLines = stderr.split('\n');
                outputLines.pop(); // pop blank line
                logger.log('[git]['+repo.name+'] DONE ' + outputLines.pop());

                if (repo.rev == 'HEAD') {

                    return execProm('git rev-parse --verify HEAD', {cwd: repo.cacheFolder}).spread(function (stdout, stderr) {

                        var hash = stdout.split('\n')[0];
                        repo.rev = hash;
                        repo.cacheTarPath = cachePath+'/'+repo.name+ '-' + repo.rev + '.tgz';
                        logger.log('[git]['+repo.name+'] Actual Hash that will be used ' + repo.rev);
                    });
                }


            });
        }).then(function () {

            if (fs.existsSync(repo.cacheTarPath)) {
                return;
            }

            var origPack = fs.readFileSync(repo.cacheFolder + '/package.json'),
                output = JSON.parse(origPack);

            Object.keys(output.dependencies).forEach(function (dep) {

                var ver = output.dependencies[dep];

                if (/git@github\.dominionenterprises\.com/.test(ver) || /git@stash\.homes\.com/.test(ver) && mapping.hasOwnProperty(dep)) {
                    output.dependencies[dep] = '*';
                }
            });

            fs.writeFileSync(repo.cacheFolder + '/package.json', JSON.stringify(output));

            logger.log('[git]['+repo.name+'] Creating tgz archive');
            return execProm(util.format('git commit -a -m "wow" && git archive --format=tar --prefix=package/ --output=%s HEAD && git reset --hard HEAD^', repo.cacheTarPath), {cwd: repo.cacheFolder}).spread(function (stdout, stderr) {

                logger.log('[git]['+repo.name+'] DONE Creating tgz archive');
            });
        });

        return prom;
    });

    ok = ok.then(function () {

        logger.log('[git]['+repo.name+'] Loading package.json');

        var output = JSON.parse(fs.readFileSync(repo.cacheFolder + '/package.json'));

        output.version += '-' + repo.rev;
        output.dist = {
            tarball: 'http://somewhere/' + repo.name + '/-/' + repo.name + '-' + repo.rev + '.tgz',
            shasum: sha.getSync(repo.cacheTarPath)
        };
        output._id = util.format('%s-%s', repo.name, output.version);

        Object.keys(output.dependencies).forEach(function (dep) {
            var ver = output.dependencies[dep];

            if (/git@github\.dominionenterprises\.com/.test(ver) && mapping.hasOwnProperty(dep)) {
                output.dependencies[dep] = '*';
            }
        });

        output = Package._rewriteLocation(output);
        repo.packageJSON = output;

        logger.log('[git]['+repo.name+'] DONE Loading package.json');
    });

    ok = ok.then(function () {

        callback(null, repo.packageJSON);
    });

    ok = ok.catch(function (err) {

        callback(err);
    });
};

exports.getTarball = function (name, callback) {
    var repo = mapping[name],
        prom,
        indexProm = BPromise.promisify(exports.getIndex);

    if (!repo.cacheTarPath || !fs.existsSync(repo.cacheTarPath)) {
        prom = indexProm(name);
    } else {
        prom = BPromise.resolve();
    }

    prom = prom.then(function () {
        callback(null, fs.createReadStream(repo.cacheTarPath));
    });

    prom.catch(function (err) {
        callback(err);
    });
};

