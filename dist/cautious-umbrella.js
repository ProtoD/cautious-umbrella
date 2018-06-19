import _get from 'lodash/get';
import _set from 'lodash/set';
import _forEach from 'lodash/forEach';
import _map from 'lodash/map';

class Request {
  constructor(config) {
    this._decodeResponse = config.decodeResponse.bind(this);
    this._encodeRequest = config.encodeRequest.bind(this);
    this._execute = config.execute.bind(this);
    this._resourceTraits = config.resources;
    this._defaultIdentifier = config.defaultIdentifier || 'id';
  }

  get defaultIdentifier() {
    return this._defaultIdentifier;
  }

  _callRequest(config) {
    let resourceTraits = this._getResourceTraits(config);
    return this._execute(config, resourceTraits);
  }

  _callDecodeResponse(response, requestConfig) {
    let decodeResponse = this._decodeResponse;
    if (decodeResponse) {
      return decodeResponse(response, requestConfig, requestConfig.resource);
    }
    return response;
  }

  _transformResponse(response, config) {
    let resourceTraits = this._getResourceTraits(config);
    if (resourceTraits) {
      let resource = config.resource;
      let transform = resourceTraits.transformResponseEntry;
      if (transform) {
        if (config.isArray) {
          if (response.data) {
            response.data = response.data.map((entry) => transform(entry, config, resource));
          }
        } else {
          response.data = transform(response.data, config, resource);
        }
      }
      transform = resourceTraits.transformResponse;
      if (transform) {
        response = transform(response, config, resource);
      }
    }
    return response;
  }

  _getResourceTraits(config) {
    let resource = config.resource;
    if (Array.isArray(resource)) {
      resource = resource[0];
    }
    let resourceTraits = this._resourceTraits;

    return resourceTraits && resourceTraits[resource] || null;
  }

  _createIndexedData(response, config) {
    let res = {};
    let resourceTraits = this._getResourceTraits(config);
    let identifier = resourceTraits && resourceTraits.identifier || this._defaultIdentifier;
    let data = response.data;
    if (data) {
      if (config.isArray) {
        _forEach(data, (entry) => {
          let id = entry[identifier];
          res[id] = entry;
        });
      } else {
        let id = data[identifier];
        res[id] = data;
      }
    }
    return res;
  }

  _getHeadResource(config) {
    let resource = config.resource;
    if (Array.isArray(resource)) {
      return resource[0];
    } else if (typeof resource == 'string') {
      return resource;
    } else {
      throw new Error('Invalid resource specification');
    }
  }

  _extractReferenceIds(response, config, path) {
    if (response.data) {
      let headResource = this._getHeadResource(config);
      let data = config.isArray ? response.data : [response.data];
      let ids = {};

      function addIdIfValid(value) {
        if (value != null) {
          let type = typeof value;
          if (type == 'number' || type == 'string' || type == "boolean") {
            ids[value] = value;
          } else {
            console.warn(`Wrong type of resource reference id: ${headResource}[\'${path}\']. Skipped`);
          }
        }
      }

      _forEach(data, entry => {
        let value = _get(entry, path, null);
        if (Array.isArray(value)) {
          _forEach(value, addIdIfValid);
        } else {
          addIdIfValid(value);
        }
      });

      return Object.keys(ids);
    }
    return [];
  }

  _replaceReferenceIds(response, config, referenceResponse, referenceConfig, path) {
    let referenceData = referenceResponse.data;
    if (referenceData) {
      let referenceHeadResource = this._getHeadResource(referenceConfig);
      let indexedReferenceData = this._createIndexedData(referenceResponse, referenceConfig);
      let data = config.isArray ? response.data : [response.data];

      function mapIdToReferenceEntry(id) {
        let type = typeof id;
        if (type == 'number' || type == 'string' || type == 'boolean') {
          let res = indexedReferenceData[id];
          if (res !== undefined) {
            return res;
          } else {
            console.warn(`Reference of type ${referenceHeadResource} with id=${id} hasn't been found. Replacing with null`);
          }
        }
        return null;
      }

      _forEach(data, entry => {
        let id = _get(entry, path, null);
        let mapping;
        if (Array.isArray(id)) {
          mapping = _map(id, (id) => mapIdToReferenceEntry);
        } else {
          mapping = mapIdToReferenceEntry(id);
        }
        _set(entry, path, mapping);
      });

    }
  }

  _normalizeConfig(config) {
    let resource = config.resource;
    if (typeof resource == 'string') {
      resource = [resource];
    } else if (!Array.isArray(resource)) {
      throw new Error('Invalid resource specification');
    }

    return Object.assign({}, config, {
      resource
    });
  }

  _extractHeadRequestConfig(config) {
    let resource = config.resource[0];

    return Object.assign({}, config, {
      resource
    });
  }

  async _loadReferences(response, config) {
    let resource = config.resource;

    if (resource.length > 1) {
      let references = resource[1];

      let paths = Object.keys(references);
      for (let i = 0; i < paths.length; i++) {
        let path = paths[i];
        let reference = references[path];
        let ids = this._extractReferenceIds(response, config, path);
        if (ids.length > 0) {
          let referenceConfig = {
            operation: 'get',
            isArray: true,
            resource: reference,
            id: ids,
          };
          let referenceResponse = await this._loadResource(referenceConfig);

          this._replaceReferenceIds(response, config, referenceResponse, referenceConfig, path);
        }
      }
    }

  }

  async _loadResource(config) {
    config = this._normalizeConfig(config);
    let requestConfig = this._extractHeadRequestConfig(config);

    try {
      let response = await this._callRequest(requestConfig);
      response = this._callDecodeResponse(response, requestConfig);
      await this._loadReferences(response, config);
      response = this._transformResponse(response, config);

      return response;
    } catch (err) {
      throw err;
    }
  }

  async get(resource, query, config) {
    let queryType = typeof query;
    if (queryType == 'number' || queryType == 'string') {
      // id
      config = Object.assign({}, config, {
        operation: 'get',
        isArray: false,
        resource,
        id: query,
      });
    } else if (Array.isArray(query)) {
      // ids
      config = Object.assign({}, config, {
        operation: 'get',
        isArray: true,
        resource,
        id: query,
      });
    } else if (queryType == 'object') {
      // query
      config = Object.assign({}, config, query, {
        operation: 'get',
        isArray: true,
        resource,
      });
    } else {
      // all
      config = Object.assign({}, config, {
        operation: 'get',
        isArray: true,
        resource,
      });
      delete config.id;
      delete config.filters;
      delete config.orderBy;
    }

    let response = await this._loadResource(config);

    return response;
  }

  create(resource, data, config) {

  }

  update(resource, data, config) {

  }

  delete(resource, config) {

  }
}

const filterParamMapping = {
    '$in': 'in',
    '$gt': 'gt',
    '$gte': 'gte',
    '$lt': 'lt',
    '$lte': 'lte',
    '$ne': 'ne',
    '$startswith': 'startswith',
    '$istartswith': 'istartswith',
    '$endswith': 'endswith',
    '$iendswith': 'iendswith',
    '$contains': 'contains',
    '$icontains': 'icontains',
};

const filterValueConverters = {
    '$in': function(value) {
        if (Array.isArray(value)) {
            return value.join(',');
        } else {
            return value;
        }
    }
};

function axiosExecute(axios) {
    return function execute(config, resourceTraits) {
        let url = config.resource;

        let filters = Object.assign({}, config.filters);

        let id = config.id;
        if (id) {
            if (Array.isArray(id)) {
                let identifier = resourceTraits && resourceTraits.identifier || this.defaultIdentifier;
                if (filters[identifier] !== undefined) {
                    throw new Error(`Filter by ${identifier} property cannot be used when id configuration parameter is specified`);
                }
                filters[identifier] = { $in: id };
            } else {
                if (!url.endsWith('/')) {
                    url = url + '/';
                }
                url = url + id;
            }
        }

        let params = {};
        _forEach(filters, (filterValue, property) => {
            if (typeof filterValue == 'object') {
                _forEach(filterValue, (value, key) => {
                    let suffix = filterParamMapping[key];
                    if (suffix !== undefined) {
                        let name = `${property}__${suffix}`;
                        let converter = filterValueConverters[key];
                        params[name] = converter ? converter(value) : value;
                    } else {
                        throw new Error(`Filter condition '${key}' is not supported`);
                    }
                });
            } else {
                params[property] = filterValue;
            }
        });
        params = Object.assign({}, config.params, params);

        let orderBy = config.orderBy;
        if (orderBy !== undefined) {
            let orderByType = typeof orderBy;
            if (orderByType == 'string') {
                params.ordering = orderBy;
            } else if (orderByType == 'object') {
                _forEach(orderBy, (dir, property) => {
                    params.ordering = dir < 0 ? '-' + property : property;
                });
            } else {
                throw new Error('Invalid orderBy specification');
            }
        }

        let headers = config.headers || {};

        let axiosConfig = {
            url,
            method: 'get',
            params,
            headers
        };

        return axios.request(axiosConfig);
    }

}

export { Request, axiosExecute };
