const maxSearchLength = 200;

String _foldSearch(Object? value, int maxLength) {
  final raw = (value ?? '').toString();
  var s = raw.substring(0, raw.length.clamp(0, maxLength)).toLowerCase();
  const from =
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
  const to =
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
  for (var i = 0; i < from.length; i++) {
    s = s.replaceAll(from[i], to[i]);
  }
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

String foldSearch(Object? value) => _foldSearch(value, maxSearchLength);

bool searchMatches(Object? value, Object? query) {
  final haystack = _foldSearch(value, 0x7fffffff);
  return foldSearch(query)
      .split(' ')
      .where((token) => token.isNotEmpty)
      .every(haystack.contains);
}

bool searchMatchesAny(Iterable<Object?> values, Object? query) =>
    searchMatches(values.join(' '), query);

int searchScoreAny(Iterable<Object?> values, Object? query) {
  final fields = values.map(foldSearch).where((value) => value.isNotEmpty);
  final q = foldSearch(query);
  if (q.isEmpty) return 0;
  if (fields.any((field) => field == q)) return 1000;
  if (fields.any((field) => field.startsWith(q))) return 750;
  final joined = fields.join(' ');
  final tokens = q.split(' ').where((token) => token.isNotEmpty);
  if (!tokens.every(joined.contains)) return -1;
  return 500 - joined.indexOf(tokens.first).clamp(0, 200);
}

T? searchSubmitCandidate<T>(
  Iterable<T> items,
  Object? query,
  Iterable<Object?> Function(T item) fields,
) {
  final rows = items.toList(growable: false);
  final exact =
      rows.where((item) => searchScoreAny(fields(item), query) == 1000);
  if (exact.isNotEmpty) return exact.first;
  return rows.length == 1 ? rows.first : null;
}

class SearchRequestGuard {
  int _generation = 0;
  int get current => _generation;
  int next() => ++_generation;
  bool isCurrent(int generation) => generation == _generation;
  void invalidate() => _generation++;
}
