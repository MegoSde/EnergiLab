#include <stdio.h>
#include <stdlib.h>

int collatz(unsigned int n) {
    int count = 1;
    while (n != 1) {
        n = (n % 2 == 0) ? n / 2 : 3 * n + 1;
        count++;
    }
    return count;
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("Brug: %s <maks_værdi>\n", argv[0]);
        return 1;
    }

    unsigned int limit = atoi(argv[1]);
    int match_count = 0;

    for (unsigned int n = 1; n < limit; n++) {
        if (collatz(n) == 112) {
            match_count++;
        }
    }

    printf("Antal n < %u med længde 112: %d\n", limit, match_count);
    return 0;
}
