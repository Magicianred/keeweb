import { StorageBase } from 'storage/storage-base';

const StorageWebDav = StorageBase.extend({
    name: 'webdav',
    icon: 'server',
    enabled: true,
    uipos: 10,

    needShowOpenConfig() {
        return true;
    },

    getOpenConfig() {
        return {
            fields: [
                { id: 'path', title: 'openUrl', desc: 'openUrlDesc', type: 'text', required: true },
                {
                    id: 'user',
                    title: 'openUser',
                    desc: 'openUserDesc',
                    placeholder: 'openUserPlaceholder',
                    type: 'text'
                },
                {
                    id: 'password',
                    title: 'openPass',
                    desc: 'openPassDesc',
                    placeholder: 'openPassPlaceholder',
                    type: 'password'
                }
            ]
        };
    },

    getSettingsConfig() {
        return {
            fields: [
                {
                    id: 'webdavSaveMethod',
                    title: 'webdavSaveMethod',
                    type: 'select',
                    value: this.appSettings.webdavSaveMethod || 'default',
                    options: { default: 'webdavSaveMove', put: 'webdavSavePut' }
                }
            ]
        };
    },

    applySetting(key, value) {
        this.appSettings[key] = value;
    },

    load(path, opts, callback) {
        this._request(
            {
                op: 'Load',
                method: 'GET',
                path,
                user: opts ? opts.user : null,
                password: opts ? opts.password : null
            },
            callback
                ? (err, xhr, stat) => {
                      callback(err, xhr.response, stat);
                  }
                : null
        );
    },

    stat(path, opts, callback) {
        this._request(
            {
                op: 'Stat',
                method: 'HEAD',
                path,
                user: opts ? opts.user : null,
                password: opts ? opts.password : null
            },
            callback
                ? (err, xhr, stat) => {
                      callback(err, stat);
                  }
                : null
        );
    },

    save(path, opts, data, callback, rev) {
        const cb = function(err, xhr, stat) {
            if (callback) {
                callback(err, stat);
                callback = null;
            }
        };
        const tmpPath = path.replace(/[^\/]+$/, m => '.' + m) + '.' + Date.now();
        const saveOpts = {
            path,
            user: opts ? opts.user : null,
            password: opts ? opts.password : null
        };
        const that = this;
        this._request(
            {
                op: 'Save:stat',
                method: 'HEAD',
                ...saveOpts
            },
            (err, xhr, stat) => {
                let useTmpPath = this.appSettings.webdavSaveMethod !== 'put';
                if (err) {
                    if (!err.notFound) {
                        return cb(err);
                    } else {
                        that.logger.debug('Save: not found, creating');
                        useTmpPath = false;
                    }
                } else if (stat.rev !== rev) {
                    that.logger.debug('Save error', path, 'rev conflict', stat.rev, rev);
                    return cb({ revConflict: true }, xhr, stat);
                }
                if (useTmpPath) {
                    that._request(
                        {
                            op: 'Save:put',
                            method: 'PUT',
                            path: tmpPath,
                            data,
                            nostat: true,
                            ...saveOpts
                        },
                        err => {
                            if (err) {
                                return cb(err);
                            }
                            that._request(
                                {
                                    op: 'Save:stat',
                                    method: 'HEAD',
                                    ...saveOpts
                                },
                                (err, xhr, stat) => {
                                    if (err) {
                                        that._request({
                                            op: 'Save:delete',
                                            method: 'DELETE',
                                            path: tmpPath,
                                            ...saveOpts
                                        });
                                        return cb(err, xhr, stat);
                                    }
                                    if (stat.rev !== rev) {
                                        that.logger.debug(
                                            'Save error',
                                            path,
                                            'rev conflict',
                                            stat.rev,
                                            rev
                                        );
                                        that._request({
                                            op: 'Save:delete',
                                            method: 'DELETE',
                                            path: tmpPath,
                                            ...saveOpts
                                        });
                                        return cb({ revConflict: true }, xhr, stat);
                                    }
                                    let movePath = path;
                                    if (movePath.indexOf('://') < 0) {
                                        if (movePath.indexOf('/') === 0) {
                                            movePath =
                                                location.protocol + '//' + location.host + movePath;
                                        } else {
                                            movePath = location.href
                                                .replace(/\?(.*)/, '')
                                                .replace(/[^/]*$/, movePath);
                                        }
                                    }
                                    that._request(
                                        {
                                            op: 'Save:move',
                                            method: 'MOVE',
                                            path: tmpPath,
                                            nostat: true,
                                            headers: {
                                                Destination: encodeURI(movePath),
                                                'Overwrite': 'T'
                                            },
                                            ...saveOpts
                                        },
                                        err => {
                                            if (err) {
                                                return cb(err);
                                            }
                                            that._request(
                                                {
                                                    op: 'Save:stat',
                                                    method: 'HEAD',
                                                    ...saveOpts
                                                },
                                                (err, xhr, stat) => {
                                                    cb(err, xhr, stat);
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                        }
                    );
                } else {
                    that._request(
                        {
                            op: 'Save:put',
                            method: 'PUT',
                            data,
                            nostat: true,
                            ...saveOpts
                        },
                        err => {
                            if (err) {
                                return cb(err);
                            }
                            that._request(
                                {
                                    op: 'Save:stat',
                                    method: 'HEAD',
                                    ...saveOpts
                                },
                                (err, xhr, stat) => {
                                    cb(err, xhr, stat);
                                }
                            );
                        }
                    );
                }
            }
        );
    },

    fileOptsToStoreOpts(opts, file) {
        const result = { user: opts.user, encpass: opts.encpass };
        if (opts.password) {
            const fileId = file.uuid;
            const password = opts.password;
            let encpass = '';
            for (let i = 0; i < password.length; i++) {
                encpass += String.fromCharCode(
                    password.charCodeAt(i) ^ fileId.charCodeAt(i % fileId.length)
                );
            }
            result.encpass = btoa(encpass);
        }
        return result;
    },

    storeOptsToFileOpts(opts, file) {
        const result = { user: opts.user, password: opts.password };
        if (opts.encpass) {
            const fileId = file.uuid;
            const encpass = atob(opts.encpass);
            let password = '';
            for (let i = 0; i < encpass.length; i++) {
                password += String.fromCharCode(
                    encpass.charCodeAt(i) ^ fileId.charCodeAt(i % fileId.length)
                );
            }
            result.password = password;
        }
        return result;
    },

    _request(config, callback) {
        const that = this;
        if (config.rev) {
            that.logger.debug(config.op, config.path, config.rev);
        } else {
            that.logger.debug(config.op, config.path);
        }
        const ts = that.logger.ts();
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
            if ([200, 201, 204].indexOf(xhr.status) < 0) {
                that.logger.debug(
                    config.op + ' error',
                    config.path,
                    xhr.status,
                    that.logger.ts(ts)
                );
                let err;
                switch (xhr.status) {
                    case 404:
                        err = { notFound: true };
                        break;
                    case 412:
                        err = { revConflict: true };
                        break;
                    default:
                        err = 'HTTP status ' + xhr.status;
                        break;
                }
                if (callback) {
                    callback(err, xhr);
                    callback = null;
                }
                return;
            }
            const rev = xhr.getResponseHeader('Last-Modified');
            if (!rev && !config.nostat) {
                that.logger.debug(
                    config.op + ' error',
                    config.path,
                    'no headers',
                    that.logger.ts(ts)
                );
                if (callback) {
                    callback('No Last-Modified header', xhr);
                    callback = null;
                }
                return;
            }
            const completedOpName =
                config.op + (config.op.charAt(config.op.length - 1) === 'e' ? 'd' : 'ed');
            that.logger.debug(completedOpName, config.path, rev, that.logger.ts(ts));
            if (callback) {
                callback(null, xhr, rev ? { rev } : null);
                callback = null;
            }
        });
        xhr.addEventListener('error', () => {
            that.logger.debug(config.op + ' error', config.path, that.logger.ts(ts));
            if (callback) {
                callback('network error', xhr);
                callback = null;
            }
        });
        xhr.addEventListener('abort', () => {
            that.logger.debug(config.op + ' error', config.path, 'aborted', that.logger.ts(ts));
            if (callback) {
                callback('aborted', xhr);
                callback = null;
            }
        });
        xhr.open(config.method, config.path);
        xhr.responseType = 'arraybuffer';
        if (config.user) {
            xhr.setRequestHeader(
                'Authorization',
                'Basic ' + btoa(config.user + ':' + config.password)
            );
        }
        if (config.headers) {
            for (const [header, value] of Object.entries(config.headers)) {
                xhr.setRequestHeader(header, value);
            }
        }
        if (['GET', 'HEAD'].indexOf(config.method) >= 0) {
            xhr.setRequestHeader('Cache-Control', 'no-cache');
        }
        if (config.data) {
            const blob = new Blob([config.data], { type: 'application/octet-stream' });
            xhr.send(blob);
        } else {
            xhr.send();
        }
    }
});

export { StorageWebDav };
