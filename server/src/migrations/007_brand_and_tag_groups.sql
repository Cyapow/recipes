ALTER TABLE recipes ADD COLUMN brand TEXT;

UPDATE recipes SET brand = CASE
  WHEN origin = 'mine' THEN 'Mine'
  WHEN lower(replace(replace(trim(source_name), ' ', ''), '-', '')) = 'hellofresh' THEN 'HelloFresh'
  WHEN lower(replace(replace(trim(source_name), ' ', ''), '-', '')) = 'gousto' THEN 'Gousto'
  WHEN lower(replace(replace(trim(source_name), ' ', ''), '-', '')) = 'simplycook' THEN 'Simply Cook'
  WHEN trim(source_name) <> '' THEN trim(source_name)
  ELSE NULL
END;

UPDATE recipes SET tags_json = (
  SELECT COALESCE(json_group_array(json_object('group', 'other', 'name', value)), '[]')
  FROM (SELECT value FROM json_each(recipes.tags_json) ORDER BY key)
);
