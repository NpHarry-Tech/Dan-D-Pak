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

class SearchRequestGuard {
  int _generation = 0;
  int get current => _generation;
  int next() => ++_generation;
  bool isCurrent(int generation) => generation == _generation;
  void invalidate() => _generation++;
}
