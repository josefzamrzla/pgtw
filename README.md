# PGTW - PostgreSQL table wrapper

Query builder for PostgreSQL with an automatic auditing option and transaction support.

## Installation
```bash
npm i pgtw
```
```bash
yarn add pgtw
```

## Usage
```javascript
import pgtw from 'pgtw';

const db = pgtw(options);

// raw SQL query
const result = await db.query('SELECT * FROM foo WHERE bar = $1', ['baz']);

// table wrapper
const products = db.table('products');
await products.getById('u-u-i-d');
await products.findOne('*', 'name = $1', ['superhero']);
await products.insert({ name: 'superhero', price: 123 });
await products.update({ price: 456 }, 'id = $1', ['u-u-i-d']);
await products.delete('name = $1', ['superhero']);

// auditing
await products.audited(userId).insert({ name: 'superhero', price: 123 });
await products.audited(userId).delete('name = $1', ['superhero']);
await db.auditedQuery(userId, 'DELETE FROM foo WHERE bar = $1', ['baz']);

// transactions
const transaction = await db.transaction();
try {
  await products.insert({ name: 'superhero', price: 123 }, transaction);
  await products.update({ price: 456 }, 'id = $1', ['u-u-i-d'], transaction);
  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}
```


## Options
 - `user`: database user name
 - `password`: database user password
 - `host`: database hostname (*localhost* by default)
 - `port`: database port (*5432* by default)
 - `database`: database name
 - `loggingFn`: logging callback (no-op by default)
 - `onConnectionError`: called when db connection fails

### Logging callback (options.loggingFn)
If set, then the logging callback is called with params:
 - `sql`: SQL query (with prepared statements)
 - `params`: query params
 - `stats`: JSON object with query stats:
  - `command`: SQL query command (eg. SELECT, UPDATE, ...)
  - `took`: time the query took in milliseconds
  - `rows`: number of returned/affected rows
  - `alias`: query alias for log aggregations
  - `audit`: caller user ID, see auditing


## Methods

All methods takes `opts` as last param, it contains:
 - `auditUserId`: caller user ID for auditing (automatically set)
 - `alias`: SQL query alias for log aggregations
 - `client`: instance of PG client to run query in transaction (automtically set)

### `query(sql, params, opts = {})`
Runs a raw SQL query with prepared statements.
```sql
db.query('SELECT * FROM foo = $1', ['bar']);
```
Returns query result object:
 - `command`: SQL command
 - `rowCount`: number of returned/affected rows
 - `rows`: array of rows returned by query

### `auditedQuery(auditUserId, sql, params, opts = {})`
Auditing version of `query` method.
- `auditUserId`: caller user ID

### `transaction()`
Create a transaction. Returns transaction object:
 - `client`: PG client instance to pass to other methods to run them in transaction
 - `commit`: callback to COMMIT transaction
 - `rollback`: callback to ROLLBACK transaction

```javascript
const transaction = await db.transaction();
try {
  await products.insert({ name: 'superhero', price: 123 }, transaction); // <- short syntax, pass whole transaction object as opts param
  await products.update({ price: 456 }, 'id = $1', ['u-u-i-d'], { client: transaction.client });
  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}
```

## Table wrapper

### `table(tableName)`
Creates new table wrapper.

## Table wrapper methods

### `audited(auditUserId)`
Creates audited table wrapper.
 - `auditUserId`: a caller user ID (user who executes the query)

Audited table wrapper support methods (see their description below):
 - `delete(where, params = [], opts = {})`
 - `insert(data = {}, opts = {})`
 - `insertIfNotExists(data = {}, where, params = [], opts = {})`
 - `update(data = {}, where, params = [], opts = {})`
 - `upsert(data = {}, where, params = [], opts = {})`

### `getById(id, fields = '*', opts = {})`
Get record from table by `id` column
 - `id`: record ID
 - `fields`: comma separated list of columns to be returned by query

Returns found row or `null`.

```javascript
await products.getById(123);
```

### `getAll(fields = '*', suffix = '', opts = {})`
Get all records from table.

 - `fields`: comma separated list of columns to be returned by query
 - `suffix`: SQL fragment to append the SQL SELECT query (appended after FROM statement)

Returns array of rows.

```javascript
await products.getAll();
```

### `firstRow(fields = '*', orderBy = '', opts = {})`
Get first record from table.
 - `fields`: comma separated list of columns to be returned by query
 - `orderBy`: name of column to order rows by

Returns found row or `null`.

```javascript
await products.firstRow('*', 'id DESC');
```

### `find(fields = '*', where, params = [], suffix = '', opts = {})`
 - `fields`: comma separated list of columns to be returned by query
 - `where`: WHERE condition fragment with prepared statements
 - `params`: array of params for prepared statements
 - `suffix`: SQL fragment to append the SQL SELECT query (appended after WHERE statement)

Returns array of rows.

```javascript

await products.find('id, name', 'price > $1', [100]);
```

### `findOne(fields = '*', where, params = [], opts = {})`
The same as `find` method, returns found row or `null`;

```javascript

await products.findOne('id, name', 'name = $1', ['superhero']);
```


### `count(where, params = [], suffix = '', opts = {})`
Count number of rows by `where` and `params`.

```javascript

await products.count('name LIKE $1', ['super%']);
```

### `insert(data = {}, opts = {})`
Inserts new row to the table.
 - `data`: JSON object with row data
Returns inserted row.

```javascript

await products.insert({ name: 'superhero', price: 100 });
```

### `insertIfNotExists(data = {}, where, params = [], opts = {})`
A combination of `find` and `insert` methods. If a record does not exist by specified condition then create it, otherwise return found record.

**throws InvalidConditionError**
If a condition returns more than one row, `InvalidConditionError` is thrown.

```javascript
// create product 'superhero' if not exists yet
await products.insertIfNotExists({ name: 'superhero', price: 100 }, 'name = $1', ['superhero']);
```

### `update(data = {}, where, params = [], opts = {})`
Updates row(s) by given conditions.
 - `data`: JSON object with row data
 - `where`: WHERE condition fragment with prepared statements
 - `params`: array of params for prepared statements

Returns updated row or array of updated rows (if affects more than one).

```javascript
await products.update({ price: 100, discount: true }, 'price > $1', [150]);
```

### `upsert(data = {}, where, params = [], opts = {})`
A combination of `find`+`update` and `insert` methods. If a record does not exist by specified condition then create it, otherwise update found record.

**throws InvalidConditionError**
If a condition returns more than one row, `InvalidConditionError` is thrown.

```javascript
// create product 'new superhero' if not exists yet, if exists then rename it to 'new superhero'
await products.upsert({ name: 'new superhero', price: 100 }, 'name = $1', ['superhero']);
```

### `delete(where, params = [], opts = {})`
Delete record by given conditions.
 - `where`: WHERE condition fragment with prepared statements
 - `params`: array of params for prepared statements
Returns deleted row or `null`.

```javascript
await products.delete({'price > $1 AND discount IS $2', [1000, true]);
```

## Automatic auditing
To enable automatic auditing:
 1. create table to store audit records
  ```sql
  CREATE TABLE audit (
    id serial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    operation varchar(6) NOT NULL,
    schema_name varchar(20) NOT NULL,
    table_name varchar(50) NOT NULL,
    key uuid,
    new_values json,
    old_values json,
    user_id uuid
  );
  ```
 2. create functions for auditing triggers
  ```sql
  -- function set user id in transaction session
  CREATE OR REPLACE FUNCTION session_set_user_id(in_user_id uuid) RETURNS uuid AS
  $$
  BEGIN
    EXECUTE 'SET LOCAL session.user_id = ''' || in_user_id::varchar || '''';
    RETURN in_user_id;
  END;
  $$
  LANGUAGE plpgsql;

  -- function returns user id stored in transaction session
  CREATE OR REPLACE FUNCTION session_get_user_id() RETURNS uuid AS
  $$
  DECLARE
    v_user_id varchar;
  BEGIN
    SHOW session.user_id INTO v_user_id;
    RETURN NULLIF(v_user_id, '')::uuid;
    EXCEPTION WHEN SQLSTATE '42704' THEN RETURN NULL;
  END;
  $$
  LANGUAGE plpgsql;

  -- function returns json with selected keys from another json
  CREATE OR REPLACE FUNCTION json_pick(in_json json, in_keys text[]) RETURNS json AS
  $$
  DECLARE
    v_items text[];
    v_key text;
  BEGIN
    FOREACH v_key IN ARRAY in_keys LOOP
      v_items := array_append(v_items, '"' || v_key || '":' || json_extract_path(in_json, v_key));
    END LOOP;
    RETURN ('{' || array_to_string(v_items, ',') || '}')::json;
  END;
  $$
  LANGUAGE plpgsql IMMUTABLE;

  -- audit trigger - logs change into "audit" table, takes primary key name as argument (eg. id etc.)
  CREATE OR REPLACE FUNCTION audit_trigger() RETURNS trigger AS
  $$
  DECLARE
    v_new json;
    v_old json;
    v_key uuid;
  BEGIN
    v_key := json_extract_path_text(row_to_json(CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END), TG_ARGV[0])::uuid;

    CASE TG_OP
      WHEN 'INSERT' THEN
      v_new := row_to_json(NEW);
      WHEN 'UPDATE' THEN
      v_new := row_to_json(NEW);
      v_old := row_to_json(OLD);
      DECLARE
        r record;
        v_changed text[] := ARRAY[]::text[];
        v_exclude text[] := (CASE WHEN TG_ARGV[1] IS NOT NULL THEN TG_ARGV[1]::text[] ELSE ARRAY[]::text[] END);
      BEGIN
        FOR r IN (SELECT * FROM json_each_text(v_new)) LOOP
          IF (r.value IS DISTINCT FROM json_extract_path_text(v_old, r.key) AND (ARRAY[r.key] && v_exclude) = FALSE) THEN
            v_changed := array_append(v_changed, r.key);
          END IF;
        END LOOP;
        IF (array_length(v_changed, 1) IS NULL) THEN
          RETURN NULL;
        END IF;
        v_new := json_pick(v_new, v_changed);
        v_old := json_pick(v_old, v_changed);
      END;
      WHEN 'DELETE' THEN
      v_old := row_to_json(OLD);
    ELSE
      RETURN NULL;
    END CASE;

    INSERT INTO audit (operation, schema_name, table_name, key, new_values, old_values, user_id)
    VALUES (TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, v_key, v_new, v_old, session_get_user_id());

    RETURN NULL;
  END;
  $$
  LANGUAGE plpgsql VOLATILE
  COST 100;
  ```

 3. create auditing trigger on every table you want audit, eg. table `product`:
  ```sql
  DROP TRIGGER IF EXISTS product_audit_trigger ON product;
  CREATE TRIGGER product_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON product
  FOR EACH ROW EXECUTE PROCEDURE audit_trigger('id');
  ```

  Trigger function `audit_trigger` takes two params:
   - id: a name of primary key column. For multiple columns primary key set NULL: `EXECUTE PROCEDURE audit_trigger(NULL)`
   - excluded columns: an array (in SQL format!) of columns that should be ignored. Eg. `EXECUTE PROCEDURE audit_trigger('id', '{updated_at}')` - changes in column `updated_at` will be ignored

## TODO
TESTS!!!
