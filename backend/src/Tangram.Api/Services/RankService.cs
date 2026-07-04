namespace Tangram.Api.Services;

// Fractional/lexicographic ranking: generates a string key that sorts between
// two existing keys (or at either open end), so appending or later moving an
// item only ever touches that one row's rank — never a renumber of siblings.
public static class RankService
{
    private const string Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    public static string Initial() => GenerateBetween(null, null);

    public static string GenerateBetween(string? lower, string? upper)
    {
        if (lower is not null && upper is not null && string.CompareOrdinal(lower, upper) >= 0)
        {
            throw new ArgumentException("lower must sort before upper");
        }

        var result = new List<char>();
        var i = 0;

        while (true)
        {
            var lowerDigit = i < (lower?.Length ?? 0) ? Digits.IndexOf(lower![i]) : 0;
            var upperDigit = upper is not null && i < upper.Length ? Digits.IndexOf(upper[i]) : Digits.Length;

            if (lowerDigit + 1 < upperDigit)
            {
                var mid = lowerDigit + (upperDigit - lowerDigit) / 2;
                result.Add(Digits[mid]);
                break;
            }

            result.Add(Digits[lowerDigit]);
            i++;
        }

        return new string(result.ToArray());
    }
}
