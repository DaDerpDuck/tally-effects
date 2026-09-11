export function getOrInsert<K, V>(map: Map<K, V>, key: K, defaultValue: V): V {
	if (!map.has(key)) map.set(key, defaultValue);
	return map.get(key)!;
}

export function getOrInsertComputed<K, V>(map: Map<K, V>, key: K, computed: () => V): V {
	if (!map.has(key)) map.set(key, computed());
	return map.get(key)!;
}
