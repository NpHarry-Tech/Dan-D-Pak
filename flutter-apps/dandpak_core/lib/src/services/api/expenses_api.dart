part of '../api_service.dart';

extension ApiServiceExpensesApi on ApiService {
  Future<Map<String, dynamic>> getExpenses({
    String from = '',
    String to = '',
    String source = '',
    String categoryId = '',
  }) async {
    final q = <String>[];
    if (from.isNotEmpty) q.add('from=$from');
    if (to.isNotEmpty) q.add('to=$to');
    if (source.isNotEmpty) q.add('source=$source');
    if (categoryId.isNotEmpty) q.add('category_id=$categoryId');
    return mapFrom(await getJson('/api/expenses?${q.join('&')}',
        errorMessage: 'Không tải được chi phí'));
  }

  Future<List<dynamic>> getExpenseCategories() async {
    return listFrom(await getJson('/api/expenses/categories',
        errorMessage: 'Không tải được danh mục chi phí'));
  }

  Future<Map<String, dynamic>> upsertExpenseCategory(
      Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/expenses/categories',
        body: body, errorMessage: 'Không lưu được danh mục'));
  }

  Future<Map<String, dynamic>> createExpense(Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/expenses',
        body: body, errorMessage: 'Không ghi được chi phí'));
  }

  Future<Map<String, dynamic>> updateExpense(
      String id, Map<String, dynamic> body) async {
    return mapFrom(await postJson('/api/expenses/$id',
        body: body, errorMessage: 'Không cập nhật được chi phí'));
  }

  Future<void> deleteExpense(String id) async {
    await postJson('/api/expenses/$id/delete',
        errorMessage: 'Không xóa được chi phí');
  }
}
