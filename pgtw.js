import _ from 'lodash';
import { Pool } from 'pg';
import microtime from 'microtime';

class InvalidConditionError extends Error {}

export default (options) => {
  const logFn = typeof options.loggingFn === 'function' ? options.loggingFn : () => {};
  const onConnectionError = typeof options.onConnectionError === 'function' ? options.onConnectionError : console.error; // eslint-disable-line no-console

  const pg = new Pool({
    user: options.user,
    host: options.host || 'localhost',
    port: options.port || 5432,
    database: options.database,
    password: options.password
  });

  pg.on('error', err => onConnectionError(err));

  const disconnect = async () => pg.end();

  const transaction = async (auditUserId = null) => {
    const client = await pg.connect();
    const commit = async () => {
      await client.query('COMMIT');
      return client.release();
    };

    const rollback = async () => {
      await client.query('ROLLBACK');
      return client.release();
    };
    await client.query('BEGIN');
    if (auditUserId !== null) {
      await client.query(`SELECT session_set_user_id('${auditUserId}')`);
    }
    return { client, commit, rollback };
  };

  const query = async (sql, params, opts = {}) => {
    const start = microtime.now();
    let result = {
      command: undefined,
      rowCount: undefined,
      rows: []
    };

    if (opts.auditUserId) {
      const { client, commit, rollback } = await transaction(opts.auditUserId);
      try {
        result = await client.query(sql, params);
        await commit();
      } catch (err) {
        logFn(sql, params, {
          took: microtime.now() - start,
          alias: opts.alias ? opts.alias.replace(/"/g, '') : undefined,
          audit: opts.auditUserId,
          failed: true
        });
        await rollback();
        throw err;
      }
    } else {
      result = await (opts && opts.client ? opts.client : pg).query(sql, params);
    }

    logFn(sql, params, {
      command: result.command,
      took: microtime.now() - start,
      rows: result.rowCount,
      alias: opts.alias ? opts.alias.replace(/"/g, '') : undefined,
      audit: opts.auditUserId
    });

    return result;
  };

  const auditedQuery = async (auditUserId, sql, params, opts = {}) => query(sql, params, { auditUserId, ...opts });

  return {
    query,
    auditedQuery,
    transaction,
    disconnect,
    table(table) {
      const doInsert = async (data = {}, suffix = '', opts = {}) => {
        const cols = _.keys(data);
        const queryData = _.values(data);
        let paramNo = 1;
        const placeholders = [];
        const statements = cols.map((col) => {
          placeholders.push(`$${paramNo++}`);
          return col;
        });

        const result = await query(
          `INSERT INTO ${table} (${statements.join(', ')}) VALUES (${placeholders.join(', ')}) ${suffix} RETURNING *`,
          queryData,
          { alias: `_insert_into__${table}`, ...opts }
        );

        return result.rowCount > 0 ? result.rows[0] : result.rows;
      };

      const update = async (data = {}, where, params = [], opts = {}) => {
        const { id, ...rest } = data;
        const cols = _.keys(rest);
        let queryData = _.values(rest);
        let paramNo = 1;
        const statements = cols.map(col => `${col} = $${paramNo++}`);
        const whereStatement = where.replace(/\$[0-9]+/g, () => `$${paramNo++}`);
        queryData = queryData.concat(params);

        const result = await query(
          `UPDATE ${table} SET ${statements.join(', ')} WHERE ${whereStatement} RETURNING *`,
          queryData,
          { alias: `_update__${table}`, ...opts }
        );

        return result.rowCount > 0 ? result.rows[0] : result.rows;
      };

      const find = async (fields = '*', where, params = [], suffix = '', opts = {}) => {
        const cols = fields.split(',').map(col => col.trim()).join(', ');
        const result = await query(
          `SELECT ${cols} FROM ${table} WHERE ${where} ${suffix}`,
          params,
          { alias: `_find_from__${table}`, ...opts }
        );

        return result.rows;
      };

      const findOne = async (fields = '*', where, params = [], opts = {}) => {
        const cols = fields.split(',').map(col => col.trim()).join(', ');
        const result = await query(
          `SELECT ${cols} FROM ${table} WHERE ${where} LIMIT 1`,
          params,
          { alias: `_find_one_from__${table}`, ...opts }
        );

        return result.rowCount > 0 ? result.rows[0] : null;
      };

      const doDelete = async (where, params = [], opts = {}) => {
        const result = await query(
          `DELETE FROM ${table} WHERE ${where} RETURNING *`,
          params,
          { alias: `_delete_from__${table}`, ...opts }
        );

        return result.rowCount > 0 ? result.rows[0] : null;
      };

      const insert = async (data = {}, opts = {}) => doInsert(data, '', opts);

      const insertIfNotExists = async (data = {}, where, params = [], opts = {}) => {
        const existing = await find('*', where, params, '', { alias: `_insert_ifne_into__${table}`, ...opts });

        if (existing.length === 1) {
          return existing;
        }

        if (existing.length > 1) {
          throw new InvalidConditionError('Invalid condition for insertIfNotExists, multiple rows found.');
        }

        return doInsert(data, '', { alias: `_insert_ifne_into__${table}`, ...opts });
      };

      const upsert = async (data = {}, where, params = [], opts = {}) => {
        const existing = await find('*', where, params, { alias: `_upsert_into__${table}`, ...opts });

        if (existing.length === 1) {
          return update(data, where, params, { alias: `_upsert_into__${table}`, ...opts });
        }

        if (existing.length > 1) {
          throw new InvalidConditionError('Invalid condition for upsert, multiple rows found.');
        }

        return doInsert(data, '', { alias: `_upsert_into__${table}`, ...opts });
      };

      const audited = auditUserId => ({
        delete: async (where, params = [], opts = {}) => doDelete(where, params, { auditUserId, ...opts }),
        insert: async (data = {}, opts = {}) => insert(data, { auditUserId, ...opts }),
        insertIfNotExists: async (data = {}, where, params = [], opts = {}) => insertIfNotExists(data, where, params, { auditUserId, ...opts }),
        update: async (data = {}, where, params = [], opts = {}) => update(data, where, params, { auditUserId, ...opts }),
        upsert: async (data = {}, where, params = [], opts = {}) => upsert(data, where, params, { auditUserId, ...opts }),
      });

      return {
        audited,
        delete: doDelete,
        find,
        findOne,
        async getById(id, fields = '*', opts = {}) {
          const cols = fields.split(',').map(col => col.trim()).join(', ');
          const result = await query(
            `SELECT ${cols} FROM ${table} WHERE id = $1 LIMIT 1`,
            [id],
            { alias: `_get_by_id_from__${table}`, ...opts }
          );

          return result.rowCount > 0 ? result.rows[0] : null;
        },
        async getAll(fields = '*', suffix = '', opts = {}) {
          const cols = fields.split(',').map(col => col.trim()).join(', ');
          const result = await query(`SELECT ${cols} FROM ${table} ${suffix}`, [], { alias: `_get_all_from__${table}`, ...opts });

          return result.rows;
        },
        async count(where, params = [], suffix = '', opts = {}) {
          const result = await query(
            `SELECT COUNT (*) FROM ${table} WHERE ${where} ${suffix}`,
            params,
            { alias: `_count_from__${table}`, ...opts }
          );

          return result.rows[0].count;
        },
        async firstRow(fields = '*', orderBy = '', opts = {}) {
          const cols = fields.split(',').map(col => col.trim()).join(', ');
          const result = await query(
            `SELECT ${cols} FROM ${table} ${orderBy ? `ORDER BY ${orderBy}` : ''} LIMIT 1`,
            [],
            { alias: `_first_row_from__${table}`, ...opts }
          );

          return result.rowCount > 0 ? result.rows[0] : null;
        },
        insert,
        insertIfNotExists,
        update,
        upsert,
      };
    }
  };
};
