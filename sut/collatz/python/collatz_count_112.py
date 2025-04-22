import sys

def collatz(n):
    count = 1
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        count += 1
    return count

def main():
    if len(sys.argv) < 2:
        print(f"Brug: {sys.argv[0]} <maks_værdi>")
        sys.exit(1)

    limit = int(sys.argv[1])
    match_count = 0

    for n in range(1, limit):
        if collatz(n) == 112:
            match_count += 1

    print(f"Antal n < {limit} med længde 112: {match_count}")

if __name__ == "__main__":
    main()
